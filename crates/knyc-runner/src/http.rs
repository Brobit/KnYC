//! HTTP checks (#88, design/03 `http` check spec): start the project's server on a free port, wait
//! until its ready path answers, send the step's requests and compare status and body with what
//! is expected, then stop the whole process tree. The client is a few lines of HTTP/1.1 over a
//! TCP stream to 127.0.0.1: no dependency, and nothing ever leaves the machine.

use crate::stream::{Finished, RunningCommand, StreamCallbacks};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 16 * 1024;
const MAX_BODY: usize = 4 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSpec {
    /// Shell command line that starts the server: "npm run start".
    pub start: String,
    /// The port the original listens on when it doesn't read `port_env`.
    pub port: u16,
    pub ready_path: String,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Environment variable the server reads its port from.
    #[serde(default = "default_port_env")]
    pub port_env: String,
}

fn default_port_env() -> String {
    "PORT".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expectation {
    pub status: u16,
    pub json_subset: Option<Value>,
    #[serde(default)]
    pub body_includes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSpec {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub body: Option<Value>,
    pub expect: Expectation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HttpStatus {
    Pass,
    Fail,
    Timeout,
    Error,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestResult {
    pub method: String,
    pub path: String,
    /// None when no answer came back.
    pub status: Option<u16>,
    pub body: String,
    /// What didn't match, in plain words; None when the request passed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpCheckOutcome {
    pub status: HttpStatus,
    /// The port the server answered on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub requests: Vec<RequestResult>,
    /// What the server printed (start-up errors are here), truncated.
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// A port nothing listens on right now.
pub fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// One HTTP/1.1 request to 127.0.0.1:`port`; returns the status and the body.
pub fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &BTreeMap<String, String>,
    body: Option<&Value>,
    timeout: Duration,
) -> Result<(u16, String), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|e| format!("no answer on port {port}: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();

    let payload = body.map(|b| b.to_string());
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\nAccept: */*\r\n"
    );
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(payload) = &payload {
        if !headers
            .keys()
            .any(|k| k.eq_ignore_ascii_case("content-type"))
        {
            head.push_str("Content-Type: application/json\r\n");
        }
        head.push_str(&format!("Content-Length: {}\r\n", payload.len()));
    }
    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .map_err(|e| e.to_string())?;
    if let Some(payload) = payload {
        stream
            .write_all(payload.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("the answer was cut: {e}"))?;
    parse_response(&raw)
}

fn parse_response(raw: &[u8]) -> Result<(u16, String), String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("not an HTTP answer")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or("not an HTTP answer")?;
    let chunked = lines.any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("transfer-encoding:") && lower.contains("chunked")
    });
    let rest = &raw[split + 4..];
    let body = if chunked {
        dechunk(rest)
    } else {
        rest.to_vec()
    };
    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}

fn dechunk(mut rest: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    while let Some(end) = rest.windows(2).position(|w| w == b"\r\n") {
        let size = usize::from_str_radix(
            String::from_utf8_lossy(&rest[..end])
                .split(';')
                .next()
                .unwrap_or("")
                .trim(),
            16,
        )
        .unwrap_or(0);
        rest = &rest[end + 2..];
        if size == 0 || size > rest.len() {
            break;
        }
        body.extend_from_slice(&rest[..size]);
        rest = rest.get(size + 2..).unwrap_or(&[]);
    }
    body
}

/// `expected` is found in `actual`: objects by their keys, arrays element by element, the rest equal.
pub fn json_subset(expected: &Value, actual: &Value) -> bool {
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => e
            .iter()
            .all(|(k, v)| a.get(k).is_some_and(|av| json_subset(v, av))),
        (Value::Array(e), Value::Array(a)) => {
            e.len() == a.len() && e.iter().zip(a).all(|(ev, av)| json_subset(ev, av))
        }
        _ => expected == actual,
    }
}

fn check_answer(spec: &HttpRequestSpec, status: u16, body: &str) -> Option<String> {
    if status != spec.expect.status {
        return Some(format!(
            "expected status {}, got {status}",
            spec.expect.status
        ));
    }
    if let Some(subset) = &spec.expect.json_subset {
        match serde_json::from_str::<Value>(body) {
            Ok(actual) if json_subset(subset, &actual) => {}
            Ok(_) => return Some(format!("the JSON body doesn't contain {subset}")),
            Err(_) => return Some("expected a JSON body".into()),
        }
    }
    spec.expect
        .body_includes
        .iter()
        .find(|text| !body.contains(text.as_str()))
        .map(|text| format!("the body doesn't contain \"{text}\""))
}

fn cut(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

/// Starts the server in `cwd`, runs the requests, stops it. `timeout` bounds the start-up.
pub fn run_http_check(
    server: &ServerSpec,
    requests: &[HttpRequestSpec],
    cwd: &Path,
    timeout: Duration,
) -> HttpCheckOutcome {
    let started = Instant::now();
    let output = Arc::new(Mutex::new(String::new()));
    let finished: Arc<Mutex<Option<Finished>>> = Arc::new(Mutex::new(None));
    let done = |status: HttpStatus,
                port: Option<u16>,
                results: Vec<RequestResult>,
                error: Option<String>,
                output: &Arc<Mutex<String>>| HttpCheckOutcome {
        status,
        port,
        requests: results,
        output: cut(
            &output.lock().map(|o| o.clone()).unwrap_or_default(),
            MAX_OUTPUT,
        ),
        error,
        duration_ms: started.elapsed().as_millis() as u64,
    };

    let port = match free_port() {
        Ok(port) => port,
        Err(e) => {
            return done(
                HttpStatus::Error,
                None,
                vec![],
                Some(format!("no free port: {e}")),
                &output,
            );
        }
    };
    // Something already answering on the original's port isn't our server.
    let quick = Duration::from_millis(300);
    let busy = server.port != port
        && request(
            server.port,
            "GET",
            &server.ready_path,
            &BTreeMap::new(),
            None,
            quick,
        )
        .is_ok();

    let mut env = server.env.clone();
    env.insert(server.port_env.clone(), port.to_string());
    let sink = Arc::clone(&output);
    let exit = Arc::clone(&finished);
    let running = match RunningCommand::start(
        &server.start,
        cwd,
        &env,
        StreamCallbacks {
            on_output: Box::new(move |_, text| {
                if let Ok(mut out) = sink.lock()
                    && out.len() < MAX_OUTPUT * 2
                {
                    out.push_str(&text);
                }
            }),
            on_exit: Box::new(move |f| {
                if let Ok(mut slot) = exit.lock() {
                    *slot = Some(f);
                }
            }),
        },
    ) {
        Ok(running) => running,
        Err(e) => {
            return done(
                HttpStatus::Error,
                None,
                vec![],
                Some(format!("the server couldn't start: {e:#}")),
                &output,
            );
        }
    };

    // Ready once the ready path answers (any status) on our port, or on the original's port when
    // the server doesn't read the port variable.
    let deadline = started + timeout;
    let ready_on = loop {
        if let Some(f) = finished.lock().ok().and_then(|f| f.clone()) {
            drop(running);
            let code = f
                .exit_code
                .map_or("a signal".to_string(), |c| format!("exit code {c}"));
            return done(
                HttpStatus::Error,
                None,
                vec![],
                Some(format!("the server stopped before answering ({code})")),
                &output,
            );
        }
        if request(
            port,
            "GET",
            &server.ready_path,
            &BTreeMap::new(),
            None,
            quick,
        )
        .is_ok()
        {
            break Some(port);
        }
        if !busy
            && server.port != port
            && request(
                server.port,
                "GET",
                &server.ready_path,
                &BTreeMap::new(),
                None,
                quick,
            )
            .is_ok()
        {
            break Some(server.port);
        }
        if Instant::now() >= deadline {
            break None;
        }
        thread::sleep(Duration::from_millis(200));
    };
    let Some(answering) = ready_on else {
        drop(running);
        let busy_note = if busy {
            format!("; port {} is used by another program", server.port)
        } else {
            String::new()
        };
        return done(
            HttpStatus::Timeout,
            None,
            vec![],
            Some(format!(
                "the server didn't answer {} on port {port} within {} s{busy_note}",
                server.ready_path,
                timeout.as_secs()
            )),
            &output,
        );
    };

    let mut results = Vec::new();
    for spec in requests {
        let answer = request(
            answering,
            &spec.method,
            &spec.path,
            &spec.headers,
            spec.body.as_ref(),
            Duration::from_secs(10),
        );
        results.push(match answer {
            Ok((status, body)) => RequestResult {
                method: spec.method.clone(),
                path: spec.path.clone(),
                status: Some(status),
                problem: check_answer(spec, status, &body),
                body: cut(&body, MAX_BODY),
            },
            Err(problem) => RequestResult {
                method: spec.method.clone(),
                path: spec.path.clone(),
                status: None,
                body: String::new(),
                problem: Some(problem),
            },
        });
    }
    drop(running);
    let status = if results.iter().all(|r| r.problem.is_none()) {
        HttpStatus::Pass
    } else {
        HttpStatus::Fail
    };
    let note = (answering != port).then(|| {
        format!(
            "the server ignores {} and listens on {answering}",
            server.port_env
        )
    });
    done(status, Some(answering), results, note, &output)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A notes server in one `node -e`: GET /health, GET /notes (JSON), POST /notes (201).
    const SERVER: &str = r#"node -e "const http=require('http');const notes=[{id:1,title:'a'}];http.createServer((q,s)=>{if(q.url==='/health'){s.end('ok');return}if(q.url==='/notes'&&q.method==='GET'){s.setHeader('content-type','application/json');s.end(JSON.stringify(notes));return}if(q.url==='/notes'&&q.method==='POST'){let b='';q.on('data',c=>b+=c);q.on('end',()=>{const n={id:2,...JSON.parse(b)};s.statusCode=201;s.end(JSON.stringify(n))});return}s.statusCode=404;s.end('nope')}).listen(process.env.PORT)""#;

    fn spec(start: &str) -> ServerSpec {
        ServerSpec {
            start: start.into(),
            port: 3999,
            ready_path: "/health".into(),
            env: BTreeMap::new(),
            port_env: "PORT".into(),
        }
    }

    fn get(path: &str, status: u16) -> HttpRequestSpec {
        HttpRequestSpec {
            method: "GET".into(),
            path: path.into(),
            headers: BTreeMap::new(),
            body: None,
            expect: Expectation {
                status,
                json_subset: None,
                body_includes: vec![],
            },
        }
    }

    #[test]
    fn checks_requests_against_the_running_server() {
        let dir = tempfile::tempdir().unwrap();
        let mut list = get("/notes", 200);
        list.expect.json_subset = Some(serde_json::json!([{ "title": "a" }]));
        let create = HttpRequestSpec {
            method: "POST".into(),
            path: "/notes".into(),
            headers: BTreeMap::new(),
            body: Some(serde_json::json!({ "title": "b" })),
            expect: Expectation {
                status: 201,
                json_subset: Some(serde_json::json!({ "id": 2, "title": "b" })),
                body_includes: vec![],
            },
        };
        let wrong = get("/missing", 200);
        let out = run_http_check(
            &spec(SERVER),
            &[list, create, wrong],
            dir.path(),
            Duration::from_secs(20),
        );
        assert_eq!(out.status, HttpStatus::Fail, "{out:?}");
        assert!(out.requests[0].problem.is_none(), "{:?}", out.requests[0]);
        assert!(out.requests[1].problem.is_none(), "{:?}", out.requests[1]);
        assert_eq!(
            out.requests[2].problem.as_deref(),
            Some("expected status 200, got 404")
        );
    }

    #[test]
    fn says_when_the_server_stops_or_never_answers() {
        let dir = tempfile::tempdir().unwrap();
        let crash = run_http_check(
            &spec(
                r#"node -e "console.error('Cannot find module ./dist/server.js');process.exit(1)""#,
            ),
            &[],
            dir.path(),
            Duration::from_secs(20),
        );
        assert_eq!(crash.status, HttpStatus::Error);
        assert!(
            crash
                .error
                .as_deref()
                .unwrap()
                .contains("stopped before answering"),
            "{crash:?}"
        );
        assert!(crash.output.contains("Cannot find module"), "{crash:?}");

        let silent = run_http_check(
            &spec(r#"node -e "setTimeout(()=>{},60000)""#),
            &[],
            dir.path(),
            Duration::from_secs(2),
        );
        assert_eq!(silent.status, HttpStatus::Timeout);
        assert!(
            silent
                .error
                .as_deref()
                .unwrap()
                .contains("didn't answer /health"),
            "{silent:?}"
        );
    }

    #[test]
    fn compares_json_by_subset_and_reads_chunked_bodies() {
        let actual = serde_json::json!({ "id": 1, "title": "a", "tags": ["x"] });
        assert!(json_subset(&serde_json::json!({ "title": "a" }), &actual));
        assert!(!json_subset(&serde_json::json!({ "title": "b" }), &actual));
        assert!(!json_subset(&serde_json::json!({ "tags": [] }), &actual));
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n";
        assert_eq!(parse_response(raw).unwrap(), (200, "Wikipedia".to_string()));
    }
}
