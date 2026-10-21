// Stands in for the Claude Code CLI in tests. Behavior is chosen by FAKE_CLAUDE_MODE and the
// answer by FAKE_CLAUDE_ANSWER; it echoes what it received so tests can check the call.
const args = process.argv.slice(2);
let stdin = "";
process.stdin.setEncoding("utf8").on("data", (d) => (stdin += d)).on("end", () => {
  const mode = process.env.FAKE_CLAUDE_MODE ?? "structured";
  const answer = JSON.parse(process.env.FAKE_CLAUDE_ANSWER ?? "{}");
  const base = {
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 0.0012,
    duration_ms: 42,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
    echo: { args, stdin, cwd: process.cwd() },
  };
  if (mode === "hang") return setTimeout(() => {}, 60_000);
  if (mode === "auth") {
    return console.log(JSON.stringify({ ...base, is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }));
  }
  if (mode === "limit") {
    return console.log(JSON.stringify({ ...base, is_error: true, result: "You've hit your session limit · resets 6:40pm (Europe/Paris)" }));
  }
  if (mode === "crash") {
    console.error("segfault-ish failure");
    process.exit(3);
  }
  if (mode === "fenced-text") return console.log(JSON.stringify({ ...base, result: "```json\n" + JSON.stringify(answer) + "\n```" }));
  if (mode === "prose") return console.log(JSON.stringify({ ...base, result: "Sure! Here it is." }));
  console.log(JSON.stringify({ ...base, result: "", structured_output: answer }));
});
