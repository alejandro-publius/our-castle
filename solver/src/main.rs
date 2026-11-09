//! The kit solver as a command: one JSON request on standard input (at most 64 KiB), one JSON answer on standard
//! output, exit code 0 (answered) or 2 (request refused). It reads no file, argument or environment variable and opens
//! no connection; the Node server that runs it checks every answer again before using it.
#![forbid(unsafe_code)]

use std::io::{Read, Write};

fn main() {
    let mut input = Vec::new();
    // Read one byte past the limit, so an oversized request is refused rather than cut short.
    let limit = (kit_solver::MAX_INPUT_BYTES + 1) as u64;
    let (text, code) = match std::io::stdin().lock().take(limit).read_to_end(&mut input) {
        Ok(_) => kit_solver::run(&input),
        Err(_) => (
            kit_solver::error_json(&kit_solver::SolveError { code: "invalid_request", message: "The request could not be read.".into() }).to_string(),
            2,
        ),
    };
    let mut out = std::io::stdout().lock();
    let written = out.write_all(text.as_bytes()).and_then(|_| out.write_all(b"\n")).and_then(|_| out.flush());
    std::process::exit(if written.is_ok() { code } else { 3 });
}
