use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Timeline {
    start: Option<Instant>,
    paused_at: Option<Instant>,
    excluded: Duration,
    pub stopped: bool,
}
impl Timeline {
    pub fn start(&mut self, now: Instant) {
        self.start = Some(now);
    }
    pub fn pause(&mut self, now: Instant) {
        if self.paused_at.is_none() {
            self.paused_at = Some(now);
        }
    }
    pub fn resume(&mut self, now: Instant) {
        if let Some(paused) = self.paused_at.take() {
            self.excluded += now.saturating_duration_since(paused);
        }
    }
    pub fn paused(&self) -> bool {
        self.paused_at.is_some()
    }
    pub fn elapsed(&self, now: Instant) -> Option<Duration> {
        self.start.map(|start| {
            self.paused_at
                .unwrap_or(now)
                .saturating_duration_since(start)
                .saturating_sub(self.excluded)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_does_not_create_a_gap_or_double_count() {
        let t = Instant::now();
        let mut clock = Timeline::default();
        assert_eq!(clock.elapsed(t), None);
        clock.start(t);
        clock.pause(t + Duration::from_secs(2));
        clock.pause(t + Duration::from_secs(3));
        assert_eq!(
            clock.elapsed(t + Duration::from_secs(5)),
            Some(Duration::from_secs(2))
        );
        clock.resume(t + Duration::from_secs(6));
        clock.resume(t + Duration::from_secs(7));
        assert_eq!(
            clock.elapsed(t + Duration::from_secs(8)),
            Some(Duration::from_secs(4))
        );
    }
}
