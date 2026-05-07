use std::sync::{
    atomic::AtomicBool,
    Arc,
    Mutex,
};

use crate::types::SyncSnapshot;

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<RuntimeState>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeState::default())),
        }
    }
}

pub struct RuntimeState {
    pub snapshot: SyncSnapshot,
    pub cancel_flag: Option<Arc<AtomicBool>>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            snapshot: SyncSnapshot::default(),
            cancel_flag: None,
        }
    }
}
