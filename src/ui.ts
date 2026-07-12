// ─── ANSI codes ───────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  blue:   "\x1b[34m",
  white:  "\x1b[37m",
  magenta:"\x1b[35m",
  clearLine: "\x1b[2K\r",
};

const isTTY = process.stdout.isTTY ?? false;

// ─── Formatters ───────────────────────────────────────────────────────────────

export const fmt = {
  bold:   (s: string) => `${C.bold}${s}${C.reset}`,
  dim:    (s: string) => `${C.dim}${s}${C.reset}`,
  green:  (s: string) => `${C.green}${s}${C.reset}`,
  red:    (s: string) => `${C.red}${s}${C.reset}`,
  yellow: (s: string) => `${C.yellow}${s}${C.reset}`,
  cyan:   (s: string) => `${C.cyan}${s}${C.reset}`,
  gray:   (s: string) => `${C.gray}${s}${C.reset}`,
  blue:   (s: string) => `${C.blue}${s}${C.reset}`,
  magenta:(s: string) => `${C.magenta}${s}${C.reset}`,
  addr:   (s: string) => fmt.cyan(shortHex(s, 6, 4)),
  hash:   (s: string) => fmt.gray(shortHex(s, 10, 6)),
  mono:   (s: string) => fmt.gray(s),
  percent: (n: number) => `${Math.max(0, Math.min(100, Math.round(n)))}%`,
  badge:  (s: string, tone: "green" | "yellow" | "red" | "cyan" | "gray" = "cyan") => {
    const color = tone === "green" ? fmt.green : tone === "yellow" ? fmt.yellow : tone === "red" ? fmt.red : tone === "gray" ? fmt.gray : fmt.cyan;
    return color(`[${s}]`);
  },
};

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function shortHex(s: string, head: number, tail: number): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function padVisible(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleLength(s)));
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    if (!isTTY) {
      process.stdout.write(`  ${fmt.gray("›")} ${this.text}\n`);
      return this;
    }
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.render();
    this.timer = setInterval(() => this.render(), 80);
    return this;
  }

  update(text: string): this {
    this.text = text;
    return this;
  }

  private render() {
    const frame = fmt.cyan(FRAMES[this.frame % FRAMES.length]!);
    process.stdout.write(`${C.clearLine}  ${frame} ${this.text}`);
    this.frame++;
  }

  succeed(msg?: string): void {
    this.stop();
    console.log(`  ${fmt.green("✓")} ${msg ?? this.text}`);
  }

  fail(msg?: string): void {
    this.stop();
    console.log(`  ${fmt.red("✗")} ${msg ?? this.text}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (isTTY) {
      process.stdout.write(`${C.clearLine}\x1b[?25h`); // show cursor
    }
  }
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export const log = {
  step: (msg: string) => console.log(`  ${fmt.gray("›")} ${msg}`),
  ok:   (msg: string) => console.log(`  ${fmt.green("✓")} ${msg}`),
  fail: (msg: string) => console.log(`  ${fmt.red("✗")} ${msg}`),
  warn: (msg: string) => console.log(`  ${fmt.yellow("!")} ${msg}`),
  info: (msg: string) => console.log(`  ${fmt.gray("·")} ${msg}`),
  line: () => console.log(fmt.gray("  " + "─".repeat(64))),
  gap:  () => console.log(),
  section: (title: string, meta?: string) =>
    console.log(`  ${fmt.cyan("┌")} ${fmt.bold(title)}${meta ? ` ${fmt.gray(meta)}` : ""}`),
  end: () => console.log(`  ${fmt.cyan("└")} ${fmt.gray("done")}`),
  kv:   (key: string, val: string) =>
    console.log(`  ${fmt.gray("│")} ${fmt.gray(padVisible(key, 18))} ${val}`),
  kvdim: (key: string, val: string) =>
    console.log(`  ${fmt.gray("│")} ${fmt.gray(padVisible(key, 18))} ${fmt.dim(val)}`),
  result: (label: string, value: string, tone: "green" | "yellow" | "red" | "cyan" = "green") => {
    const color = tone === "green" ? fmt.green : tone === "yellow" ? fmt.yellow : tone === "red" ? fmt.red : fmt.cyan;
    console.log(`  ${color("●")} ${fmt.bold(label)} ${value}`);
  },
  command: (cmd: string) => console.log(`  ${fmt.gray("$")} ${fmt.cyan(cmd)}`),
  progress: (label: string, percent: number, tone: "green" | "yellow" | "red" | "cyan" = "cyan") => {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const width = 28;
    const filled = Math.round((clamped / 100) * width);
    const color = tone === "green" ? fmt.green : tone === "yellow" ? fmt.yellow : tone === "red" ? fmt.red : fmt.cyan;
    const bar = color("█".repeat(filled)) + fmt.gray("░".repeat(width - filled));
    console.log(`  ${fmt.gray("│")} ${fmt.gray(padVisible(label, 18))} ${bar} ${color(`${clamped}%`)}`);
  },
  callout: (title: string, body: string, tone: "green" | "yellow" | "red" | "cyan" = "cyan") => {
    const color = tone === "green" ? fmt.green : tone === "yellow" ? fmt.yellow : tone === "red" ? fmt.red : fmt.cyan;
    console.log(`  ${color("◆")} ${fmt.bold(title)} ${body}`);
  },
  metrics: (items: Array<{ label: string; value: string; tone?: "green" | "yellow" | "red" | "cyan" | "gray" }>) => {
    const width = 20;
    const cells = items.map((item) => {
      const color = item.tone === "green" ? fmt.green
        : item.tone === "yellow" ? fmt.yellow
          : item.tone === "red" ? fmt.red
            : item.tone === "gray" ? fmt.gray
              : fmt.cyan;
      return `${fmt.gray(item.label)} ${color(fmt.bold(item.value))}`;
    });
    console.log(`  ${cells.map((cell) => padVisible(cell, width)).join(fmt.gray("│ "))}`);
  },
  deal: (items: Array<{ label: string; value: string; note?: string; tone?: "green" | "yellow" | "red" | "cyan" | "gray" }>) => {
    const width = 22;
    console.log(`  ${fmt.cyan("╭")}${fmt.cyan("─".repeat(70))}${fmt.cyan("╮")}`);
    for (const item of items) {
      const color = item.tone === "green" ? fmt.green
        : item.tone === "yellow" ? fmt.yellow
          : item.tone === "red" ? fmt.red
            : item.tone === "gray" ? fmt.gray
              : fmt.cyan;
      const left = fmt.gray(padVisible(item.label, width));
      const right = `${color(fmt.bold(item.value))}${item.note ? ` ${fmt.gray(item.note)}` : ""}`;
      console.log(`  ${fmt.cyan("│")} ${left} ${padVisible(right, 46)}${fmt.cyan("│")}`);
    }
    console.log(`  ${fmt.cyan("╰")}${fmt.cyan("─".repeat(70))}${fmt.cyan("╯")}`);
  },
};

// ─── Header ───────────────────────────────────────────────────────────────────

export function header(title: string, subtitle?: string) {
  console.log();
  const brand = `${fmt.bold(fmt.cyan("ILAL"))} ${fmt.gray("Institutional Liquidity Access Layer")}`;
  const slogan = `${fmt.green("Compliance is the hook.")} ${fmt.gray("Just prove it and swap.")}`;
  const heading = `${fmt.bold(title)}${subtitle ? ` ${fmt.badge(subtitle, "gray")}` : ""}`;
  const width = Math.max(70, visibleLength(brand), visibleLength(slogan), visibleLength(heading)) + 2;
  console.log(fmt.cyan(`  ╭${"─".repeat(width)}╮`));
  console.log(`${fmt.cyan("  │")} ${padVisible(brand, width - 1)}${fmt.cyan("│")}`);
  console.log(`${fmt.cyan("  │")} ${padVisible(slogan, width - 1)}${fmt.cyan("│")}`);
  console.log(`${fmt.cyan("  ├")}${fmt.cyan("─".repeat(width))}${fmt.cyan("┤")}`);
  console.log(`${fmt.cyan("  │")} ${padVisible(heading, width - 1)}${fmt.cyan("│")}`);
  console.log(fmt.cyan(`  ╰${"─".repeat(width)}╯`));
}

// ─── Error handling ───────────────────────────────────────────────────────────

// Known contract error selectors → human-readable messages
const CONTRACT_ERRORS: Record<string, string> = {
  "0x724efe91": "Credential already exists — use `ilal credential prove` to renew",
  "0xe6567cc4": "ZK verifier not set on CNFIssuer — contact the issuer admin",
  "0xd611c318": "ZK proof verification failed — regenerate your proof",
  "0x9dd854d3": "Invalid Merkle root — issuer must queue and activate the updated root with `ilal oracle`",
  "0x0432f01c": "Merkle root mismatch — issuer must queue and activate the updated root with `ilal oracle`",
  "0xddefae28": "Credential already minted for this wallet",
  "0x30cd7471": "Not the contract owner",
  "0xf6f992e7": "Credential has expired — renew it",
  "0x6773afec": "Invalid public inputs length",
  "0xfa9f081c": "Schema hash mismatch",
  "0xb7e9429b": "Issuer hash mismatch",
  "0x0e917e64": "Wallet hash mismatch — wrong wallet key",
  "0x21374865": "Session signature invalid — re-sign hookData with the wallet that owns the CNF",
  "0xd9b2290c": "Session user mismatch — hookData can only be used by the wallet that signed it",
  "0x1fb09b80": "Session nonce already used — sign a fresh session",
};

function parseViemError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (process.env["ILAL_DEBUG"]) {
    console.error(e);
  }

  // Extract 4-byte selector from viem error
  const selMatch = msg.match(/0x[0-9a-f]{8}/i);
  if (selMatch) {
    const readable = CONTRACT_ERRORS[selMatch[0].toLowerCase()];
    if (readable) return readable;
  }

  // Simplify common viem errors
  if (msg.includes("reverted")) {
    const inner = msg.match(/reverted.*?["']([^"']+)["']/)?.[1];
    if (inner) return `Transaction reverted: ${inner}`;
    return "Transaction reverted — check contract state";
  }
  if (msg.includes("insufficient funds")) return "Insufficient gas funds in wallet";
  if (msg.includes("nonce")) return "Nonce error — try again";
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) return "RPC timeout — try again or use --rpc with a faster endpoint";

  // Trim the verbose viem stack
  return msg.split("\n")[0]!.slice(0, 120);
}

export function die(msg: string): never {
  console.error();
  console.error(`  ${fmt.red("✗")} ${fmt.bold("Error:")} ${msg}`);
  console.error();
  process.exit(1);
}

export function requirePrivateKey(rawKey?: string): `0x${string}` {
  const key = rawKey?.trim();
  if (!key) {
    die("Private key required. Use --private-key or set PRIVATE_KEY env var.");
  }
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    die("Private key must include the 0x prefix. Example: PRIVATE_KEY=0x...");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    die("Private key must be 32-byte hex and include the 0x prefix. Example: PRIVATE_KEY=0x...");
  }
  return key as `0x${string}`;
}

export function dieOnContract(e: unknown): never {
  if (process.env["ILAL_DEBUG"] === "1") console.error(e);
  die(parseViemError(e));
}
