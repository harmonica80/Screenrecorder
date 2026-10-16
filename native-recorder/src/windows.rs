use crate::timeline::Timeline;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Deserialize;
use serde_json::json;
use std::os::windows::process::CommandExt;
use std::{
    fs::{self, File},
    io::{self, BufRead, BufWriter, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::*,
    window::Window,
};
type Error = Box<dyn std::error::Error + Send + Sync>;
type Result<T> = std::result::Result<T, Error>;
type Clock = Arc<Mutex<Timeline>>;
type Failure = Arc<Mutex<Option<String>>>;
const FPS: u64 = 30;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    source: String,
    output: PathBuf,
    ffmpeg: PathBuf,
    format: String,
    codec: String,
    quality: String,
    #[serde(default)]
    system_audio: bool,
    #[serde(default)]
    microphone: bool,
    #[serde(default)]
    microphone_name: String,
    #[serde(default)]
    software: bool,
}
fn emit(value: serde_json::Value) {
    println!("{value}");
    let _ = io::stdout().flush();
}
fn command(config: &Config) -> Command {
    let mut c = Command::new(&config.ffmpeg);
    c.creation_flags(0x08000000)
        .args(["-hide_banner", "-loglevel", "error", "-y"]);
    c
}
fn fail(failure: &Failure, message: impl Into<String>) {
    let mut f = failure.lock().unwrap();
    if f.is_none() {
        *f = Some(message.into());
    }
}
#[derive(Clone)]
struct Pixels {
    width: u32,
    height: u32,
    bytes: Arc<Vec<u8>>,
}
#[derive(Clone)]
struct CaptureFlags {
    latest: Arc<Mutex<Option<Pixels>>>,
    clock: Clock,
    failure: Failure,
}
struct Capture {
    flags: CaptureFlags,
    last: Instant,
}
impl GraphicsCaptureApiHandler for Capture {
    type Flags = CaptureFlags;
    type Error = Error;
    fn new(ctx: Context<Self::Flags>) -> Result<Self> {
        Ok(Self {
            flags: ctx.flags,
            last: Instant::now() - Duration::from_secs(1),
        })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<()> {
        let clock = self.flags.clock.lock().unwrap();
        if clock.stopped {
            control.stop();
            return Ok(());
        }
        if clock.paused() || self.last.elapsed() < Duration::from_millis(30) {
            return Ok(());
        }
        drop(clock);
        self.last = Instant::now();
        let (width, height) = (frame.width(), frame.height());
        // Exactly one latest frame is retained; encoder backpressure cannot grow a queue.
        let buffer = frame.buffer()?;
        let mut packed = Vec::new();
        let bytes = buffer.as_nopadding_buffer(&mut packed).to_vec();
        *self.flags.latest.lock().unwrap() = Some(Pixels {
            width,
            height,
            bytes: Arc::new(bytes),
        });
        Ok(())
    }
    fn on_closed(&mut self) -> Result<()> {
        fail(
            &self.flags.failure,
            "錄影來源已關閉；已停止擷取並保留可回復資料。",
        );
        Ok(())
    }
}
fn settings<T: TryInto<GraphicsCaptureItemType>>(
    item: T,
    flags: CaptureFlags,
) -> Settings<CaptureFlags, T> {
    Settings::new(
        item,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    )
}
fn sources(kind: &str) -> Result<()> {
    let values: Vec<_> = if kind == "screen" {
        Monitor::enumerate()?.into_iter().map(|m| Ok(json!({
            "id":format!("monitor:{}",m.as_raw_hmonitor() as usize),
            "name":format!("{} · {} × {}",m.device_name()?,m.width()?,m.height()?), "thumbnail":""
        }))).collect::<Result<_>>()?
    } else {
        Window::enumerate()?.into_iter().filter(|w| w.is_valid()).filter_map(|w| {
            let title = w.title().ok()?;
            if title.is_empty() { return None; }
            Some(json!({"id":format!("window:{}",w.as_raw_hwnd() as usize),"name":title,"thumbnail":""}))
        }).collect()
    };
    emit(json!({"sources":values}));
    Ok(())
}

// Each audio source is written incrementally as PCM beside the video. The common
// monotonic timeline inserts silence for missing callbacks and removes pause time.
// Raw PCM avoids WAV's 4 GB size limit. Final mux copies video without re-encoding.
struct AudioFile {
    path: PathBuf,
    rate: u32,
    channels: u16,
}
struct AudioCapture {
    stream: cpal::Stream,
    writer: thread::JoinHandle<Result<AudioFile>>,
}
struct Chunk {
    end: Duration,
    samples: Vec<i16>,
}
fn audio(
    device: cpal::Device,
    loopback: bool,
    path: PathBuf,
    clock: Clock,
    failure: Failure,
) -> Result<AudioCapture> {
    let supported = if loopback {
        device.default_output_config()?
    } else {
        device.default_input_config()?
    };
    let config = supported.config();
    let (rate, channels) = (config.sample_rate.0, config.channels);
    let (tx, rx) = mpsc::sync_channel::<Chunk>(128);
    let err_failure = failure.clone();
    let on_error = move |err| fail(&err_failure, format!("音訊擷取失敗：{err}"));
    let writer_clock = clock.clone();
    let push = move |samples: Vec<i16>, info: &cpal::InputCallbackInfo| {
        let now = Instant::now();
        let clock = clock.lock().unwrap();
        if clock.stopped || clock.paused() {
            return;
        }
        if let Some(elapsed) = clock.elapsed(now) {
            // CPAL's capture timestamp refers to the first sample in the buffer.
            let timestamp = info.timestamp();
            let latency = timestamp
                .callback
                .duration_since(&timestamp.capture)
                .unwrap_or_default();
            let length =
                Duration::from_secs_f64(samples.len() as f64 / channels as f64 / rate as f64);
            let end = elapsed
                .saturating_sub(latency)
                .saturating_add(length)
                .min(elapsed + length);
            if tx.try_send(Chunk { end, samples }).is_err() {
                fail(&failure, "音訊磁碟寫入跟不上，已停止錄影以避免漏音。");
            }
        }
    };
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], info| {
                push(
                    data.iter()
                        .map(|v| (v.clamp(-1.0, 1.0) * 32767.0) as i16)
                        .collect(),
                    info,
                )
            },
            on_error,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], info| push(data.to_vec(), info),
            on_error,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], info| {
                push(
                    data.iter().map(|v| (*v as i32 - 32768) as i16).collect(),
                    info,
                )
            },
            on_error,
            None,
        )?,
        format => return Err(format!("音訊格式 {format:?} 尚未支援，請改用相容模式。").into()),
    };
    fs::write(
        path.with_extension("json"),
        serde_json::to_vec_pretty(&json!({"rate":rate,"channels":channels,"format":"s16le"}))?,
    )?;
    let file = File::create(&path)?;
    let writer = thread::spawn(move || {
        let mut output = BufWriter::new(file);
        let mut written = 0_u64;
        let zeros = [0_u8; 8192];
        for chunk in rx {
            let end_frame = (chunk.end.as_secs_f64() * rate as f64).round() as u64;
            let frames = chunk.samples.len() as u64 / channels as u64;
            let start = end_frame.saturating_sub(frames) * channels as u64;
            let mut gap = start.saturating_sub(written) * 2;
            while gap > 0 {
                let n = gap.min(zeros.len() as u64) as usize;
                output.write_all(&zeros[..n])?;
                gap -= n as u64;
            }
            let skip = written
                .saturating_sub(start)
                .min(chunk.samples.len() as u64) as usize;
            for sample in &chunk.samples[skip..] {
                output.write_all(&sample.to_le_bytes())?;
            }
            written = written.max(start + chunk.samples.len() as u64);
        }
        // A silent loopback device may deliver no callbacks at all. Ensure a
        // valid audio input and preserve silence through the end of the session.
        let elapsed = writer_clock
            .lock()
            .unwrap()
            .elapsed(Instant::now())
            .unwrap_or_default();
        let end = (elapsed.as_secs_f64() * rate as f64).ceil() as u64 * channels as u64;
        let mut tail = end.saturating_sub(written) * 2;
        while tail > 0 {
            let n = tail.min(zeros.len() as u64) as usize;
            output.write_all(&zeros[..n])?;
            tail -= n as u64;
        }
        output.flush()?;
        Ok(AudioFile {
            path,
            rate,
            channels,
        })
    });
    Ok(AudioCapture { stream, writer })
}
fn encoder(config: &Config) -> String {
    let hevc = config.codec == "h265";
    if !config.software {
        let names = if hevc {
            ["hevc_nvenc", "hevc_qsv", "hevc_amf"]
        } else {
            ["h264_nvenc", "h264_qsv", "h264_amf"]
        };
        for name in names {
            // Probe actual encoding, not just the compiled encoder list.
            let result = command(config)
                .args([
                    "-f",
                    "lavfi",
                    "-i",
                    "color=size=128x128:rate=30",
                    "-frames:v",
                    "2",
                    "-c:v",
                    name,
                    "-pix_fmt",
                    "yuv420p",
                    "-f",
                    "null",
                    "-",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            if result.is_ok_and(|status| status.success()) {
                return name.into();
            }
        }
    }
    if hevc { "libx265" } else { "libx264" }.into()
}
struct EncoderProcess(Child);
impl Drop for EncoderProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn record(config: Config) -> Result<()> {
    if !["mp4", "mkv"].contains(&config.format.as_str())
        || !["auto", "h264", "h265"].contains(&config.codec.as_str())
    {
        return Err("原生模式支援 MP4／MKV 與 H.264／H.265。".into());
    }
    if !config.output.is_absolute() || !config.ffmpeg.is_file() {
        return Err("錄影路徑或 FFmpeg 不正確。".into());
    }
    // A unique work directory is deliberately retained on failure for recovery.
    let work = config
        .output
        .with_extension(format!("native-work-{}", std::process::id()));
    fs::create_dir(&work)?;
    fs::write(
        work.join("config.json"),
        serde_json::to_vec_pretty(&json!({"format":config.format,"codec":config.codec}))?,
    )?;
    let clock: Clock = Arc::new(Mutex::new(Timeline::default()));
    let failure: Failure = Arc::new(Mutex::new(None));
    let latest = Arc::new(Mutex::new(None));
    let flags = CaptureFlags {
        latest: latest.clone(),
        clock: clock.clone(),
        failure: failure.clone(),
    };
    let host = cpal::default_host();
    let mut audio_streams = Vec::new();
    if config.system_audio {
        audio_streams.push(audio(
            host.default_output_device().ok_or("找不到系統音訊裝置")?,
            true,
            work.join("system.pcm"),
            clock.clone(),
            failure.clone(),
        )?);
    }
    if config.microphone {
        let device = if config.microphone_name.is_empty() {
            host.default_input_device().ok_or("找不到麥克風")?
        } else {
            host.input_devices()?
                .find(|d| d.name().ok().as_deref() == Some(&config.microphone_name))
                .ok_or("指定的麥克風不存在，請重新選擇或使用預設麥克風。")?
        };
        audio_streams.push(audio(
            device,
            false,
            work.join("microphone.pcm"),
            clock.clone(),
            failure.clone(),
        )?);
    }
    let (kind, id) = config.source.split_once(':').ok_or("錄影來源無效")?;
    let id = id.parse::<usize>()?;
    // Validate against the current enumeration; never accept an arbitrary handle.
    let capture = if kind == "monitor" {
        let m = Monitor::enumerate()?
            .into_iter()
            .find(|m| m.as_raw_hmonitor() as usize == id)
            .ok_or("螢幕已不存在")?;
        Capture::start_free_threaded(settings(m, flags))?
    } else if kind == "window" {
        let w = Window::enumerate()?
            .into_iter()
            .find(|w| w.as_raw_hwnd() as usize == id && w.is_valid())
            .ok_or("視窗已不存在")?;
        Capture::start_free_threaded(settings(w, flags))?
    } else {
        return Err("錄影來源類型無效".into());
    };
    let start_wait = Instant::now();
    let first = loop {
        if let Some(p) = latest.lock().unwrap().clone() {
            break p;
        }
        if capture.is_finished() || start_wait.elapsed() > Duration::from_secs(10) {
            return Err("無法取得畫面，請確認視窗未最小化或改用相容模式。".into());
        }
        thread::sleep(Duration::from_millis(10));
    };
    let width = first.width + first.width % 2;
    let height = first.height + first.height % 2;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 40_000_000 {
        return Err("畫面尺寸不支援".into());
    }
    let selected_encoder = encoder(&config);
    let temp_video = work.join("video.mkv");
    let log = File::create(work.join("encoder.log"))?;
    let mut cmd = command(&config);
    cmd.args([
        "-f",
        "rawvideo",
        "-pixel_format",
        "bgra",
        "-video_size",
        &format!("{width}x{height}"),
        "-framerate",
        "30",
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        &selected_encoder,
    ]);
    let quality = match config.quality.as_str() {
        "high" => 18,
        "small" => 28,
        _ => 23,
    };
    if selected_encoder.starts_with("libx") {
        cmd.args([
            "-preset",
            "veryfast",
            "-crf",
            &(quality + if config.codec == "h265" { 5 } else { 0 }).to_string(),
        ]);
        if config.codec == "h265" {
            cmd.args(["-x265-params", "pools=2:frame-threads=2:log-level=error"]);
        }
    } else {
        let bitrate = match config.quality.as_str() {
            "high" => "8M",
            "small" => "2M",
            _ => "4M",
        };
        cmd.args(["-b:v", bitrate]);
    }
    let child = cmd
        .args([
            "-pix_fmt",
            "yuv420p",
            "-g",
            "60",
            "-cluster_time_limit",
            "1000",
            "-f",
            "matroska",
        ])
        .arg(&temp_video)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()?;
    let mut child = EncoderProcess(child);
    let mut stdin = child.0.stdin.take().ok_or("無法開啟編碼管線")?;
    for a in &audio_streams {
        a.stream.play()?;
    }
    clock.lock().unwrap().start(Instant::now());
    let writer_clock = clock.clone();
    let writer_failure = failure.clone();
    let video_writer = thread::spawn(move || -> Result<u64> {
        let mut count = 0_u64;
        let mut output = vec![0_u8; width as usize * height as usize * 4];
        loop {
            let state = writer_clock.lock().unwrap();
            let elapsed = state.elapsed(Instant::now()).unwrap_or_default();
            if state.stopped {
                break;
            }
            let paused = state.paused();
            drop(state);
            if writer_failure.lock().unwrap().is_some() {
                break;
            }
            let target = (elapsed.as_secs_f64() * FPS as f64).floor() as u64;
            if paused || count > target {
                thread::sleep(Duration::from_millis(2));
                continue;
            }
            if target.saturating_sub(count) > FPS * 2 {
                fail(
                    &writer_failure,
                    "編碼速度持續落後，已停止錄影。請降低解析度或選用硬體編碼。",
                );
                break;
            }
            let pixels = latest.lock().unwrap().clone();
            if let Some(p) = pixels {
                output.fill(0);
                let row = p.width.min(width) as usize * 4;
                for y in 0..p.height.min(height) as usize {
                    output[y * width as usize * 4..y * width as usize * 4 + row].copy_from_slice(
                        &p.bytes[y * p.width as usize * 4..y * p.width as usize * 4 + row],
                    );
                }
                if let Err(e) = stdin.write_all(&output) {
                    fail(&writer_failure, format!("影片編碼失敗：{e}"));
                    return Err(e.into());
                }
                count += 1;
                if count == 1 {
                    emit(
                        json!({"event":"ready","encoder":selected_encoder,"width":width,"height":height,"fps":FPS}),
                    );
                }
                if count % FPS == 0 {
                    emit(json!({"event":"progress","seconds":count as f64/FPS as f64}));
                }
            }
        }
        drop(stdin);
        Ok(count)
    });
    // Commands remain responsive even if the encoder is busy. EOF stops and saves.
    let command_clock = clock.clone();
    let (commands, received) = mpsc::channel();
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) => {
                    if commands.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    loop {
        if failure.lock().unwrap().is_some() || capture.is_finished() {
            break;
        }
        match received.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                let command: serde_json::Value = serde_json::from_str(&line)?;
                let mut state = command_clock.lock().unwrap();
                match command["command"].as_str() {
                    Some("pause") => {
                        state.pause(Instant::now());
                        emit(json!({"event":"paused"}));
                    }
                    Some("resume") => {
                        state.resume(Instant::now());
                        emit(json!({"event":"resumed"}));
                    }
                    Some("stop") => break,
                    _ => {}
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    {
        let mut state = clock.lock().unwrap();
        state.pause(Instant::now());
        state.stopped = true;
    }
    let capture_result = capture.stop();
    let mut audio_files = Vec::new();
    for a in audio_streams {
        drop(a.stream);
        audio_files.push(a.writer.join().map_err(|_| "音訊執行緒失敗")??);
    }
    let frames = video_writer.join().map_err(|_| "影片執行緒失敗")??;
    let status = child.0.wait()?;
    if !status.success() || frames == 0 {
        return Err(format!("編碼失敗，記錄與暫存檔位於 {}", work.display()).into());
    }
    let duration = frames as f64 / FPS as f64;
    emit(json!({"event":"finalizing"}));
    // Persist enough metadata to recover a recording after an interrupted mux.
    fs::write(
        work.join("audio.json"),
        serde_json::to_vec_pretty(
            &audio_files
                .iter()
                .map(|a| json!({"file":a.path.file_name(),"rate":a.rate,"channels":a.channels}))
                .collect::<Vec<_>>(),
        )?,
    )?;
    let mut mux = command(&config);
    mux.arg("-i").arg(&temp_video);
    for a in &audio_files {
        mux.args([
            "-f",
            "s16le",
            "-ar",
            &a.rate.to_string(),
            "-ac",
            &a.channels.to_string(),
            "-i",
        ])
        .arg(&a.path);
    }
    mux.args(["-map", "0:v:0", "-c:v", "copy"]);
    if !audio_files.is_empty() {
        let inputs: String = (1..=audio_files.len())
            .map(|i| format!("[{i}:a]"))
            .collect();
        mux.args([
            "-filter_complex",
            &format!(
                "{inputs}amix=inputs={}:duration=longest:normalize=0,alimiter=limit=0.95,apad[a]",
                audio_files.len()
            ),
            "-map",
            "[a]",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
        ]);
    }
    if config.format == "mp4" {
        mux.args(["-movflags", "+faststart"]);
        if config.codec == "h265" {
            mux.args(["-tag:v", "hvc1"]);
        }
    }
    let result = mux
        .args([
            "-t",
            &duration.to_string(),
            "-f",
            if config.format == "mp4" {
                "mp4"
            } else {
                "matroska"
            },
        ])
        .arg(&config.output)
        .stdin(Stdio::null())
        .output()?;
    if !result.status.success() {
        return Err(format!(
            "封裝失敗：{}；原始資料保留於 {}",
            String::from_utf8_lossy(&result.stderr),
            work.display()
        )
        .into());
    }
    if let Err(error) = capture_result {
        emit(json!({"event":"warning","message":error.to_string()}));
    }
    if let Some(error) = failure.lock().unwrap().as_ref() {
        emit(json!({"event":"warning","message":error}));
    }
    fs::remove_dir_all(&work)?;
    emit(
        json!({"event":"finished","seconds":duration,"bytesWritten":fs::metadata(&config.output)?.len()}),
    );
    Ok(())
}
pub fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--sources") {
        return sources(args.get(2).map(String::as_str).unwrap_or("screen"));
    }
    if args.get(1).map(String::as_str) == Some("--version") {
        emit(json!({"version":env!("CARGO_PKG_VERSION")}));
        return Ok(());
    }
    // Read one line without a persistent BufReader, so the command reader owns
    // all subsequent stdin bytes and does not compete for a held stdin lock.
    let mut line = String::new();
    io::stdin().read_line(&mut line)?;
    let config: Config = serde_json::from_str(&line)?;
    let output = config.output.clone();
    record(config)
        .map_err(|error| format!("{error}\n復原資料位於影片旁：{}", output.display()).into())
}
