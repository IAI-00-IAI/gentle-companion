import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { relayDialogs, ToolDialogRelay, type AskChannel, type AskInput } from "../src/ask.ts";
import type { AskAnswers } from "../src/protocol.ts";

/** Companion side: records published questions and lets the test answer them. */
class FakeChannel implements AskChannel {
  readonly published: AskInput[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];
  /** Questions withdrawn by their AbortSignal (tool ended, dialog answered locally). */
  withdrawn = 0;
  private pending = new Map<number, (answers: AskAnswers | null) => void>();

  ask(request: AskInput, signal?: AbortSignal) {
    const index = this.published.length;
    this.published.push(request);
    this.signals.push(signal);
    const { promise, resolve } = Promise.withResolvers<AskAnswers | null>();
    signal?.addEventListener("abort", () => { this.withdrawn++; resolve(null); }, { once: true });
    this.pending.set(index, resolve);
    return promise;
  }

  answer(answers: AskAnswers | null) {
    const index = this.pending.keys().next().value;
    assert.notEqual(index, undefined, "a question is waiting");
    this.answerAt(index!, answers);
  }

  answerAt(index: number, answers: AskAnswers | null) {
    const settle = this.pending.get(index);
    assert.ok(settle, "the requested question is waiting");
    this.pending.delete(index);
    settle(answers);
  }
}

/** Terminal side: a ctx.ui whose custom() dialogs stay open until done() or a test answer. */
function fakeUi() {
  const open: Array<(value: unknown) => void> = [];
  const ui = {
    select: () => new Promise(() => {}),
    confirm: () => new Promise(() => {}),
    input: () => new Promise(() => {}),
    custom: (factory: (tui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => unknown) => {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      open.push(resolve);
      factory({}, {}, {}, resolve);
      return promise;
    }
  } as unknown as ExtensionUIContext;
  return { ui, open };
}

/** Each terminal dialog owns its cancellation signal, like Pi's dialog stack. */
function stackedDialogUi() {
  const { ui } = fakeUi();
  const open: Array<{ signal: AbortSignal; answer: (value: unknown) => void }> = [];
  function dialog(signal: AbortSignal | undefined, dismissed: unknown) {
    assert.ok(signal, "the relay supplies a dialog-specific signal");
    const { promise, resolve } = Promise.withResolvers<unknown>();
    signal.addEventListener("abort", () => resolve(dismissed), { once: true });
    open.push({ signal, answer: resolve });
    return promise;
  }
  Object.assign(ui, {
    select: (_title: string, _options: string[], opts?: { signal?: AbortSignal }) => dialog(opts?.signal, undefined),
    confirm: (_title: string, _message: string, opts?: { signal?: AbortSignal }) => dialog(opts?.signal, false),
    input: (_title: string, _placeholder: string, opts?: { signal?: AbortSignal }) => dialog(opts?.signal, undefined)
  });
  return { ui, open };
}

const dialogCases: Array<{
  name: string;
  start: (ui: ExtensionUIContext, title: string, signal?: AbortSignal) => Promise<unknown>;
  remoteAnswer: string;
  remoteResult: unknown;
  localResult: unknown;
  dismissed: unknown;
}> = [
  {
    name: "select",
    start: (ui, title, signal) => ui.select(title, ["a", "b"], { signal }),
    remoteAnswer: "b", remoteResult: "b", localResult: "a", dismissed: undefined
  },
  {
    name: "confirm",
    start: (ui, title, signal) => ui.confirm(title, "Continue?", { signal }),
    remoteAnswer: "Yes", remoteResult: true, localResult: false, dismissed: false
  },
  {
    name: "input",
    start: (ui, title, signal) => ui.input(title, "Your answer", { signal }),
    remoteAnswer: "remote text", remoteResult: "remote text", localResult: "local text", dismissed: undefined
  }
];

const jarArgs = {
  questions: [
    { question: "Database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
    { question: "Features?", multi: true, options: [{ label: "Auth" }, { label: "Billing" }] }
  ]
};

/** pi-jar's jar_ask: one ctx.ui.custom picker per question, in order. */
async function jarAsk(ui: ExtensionUIContext, count: number) {
  const results: unknown[] = [];
  for (let index = 0; index < count; index++) {
    results.push(await ui.custom(() => ({ render: () => [], invalidate() {} }) as never));
  }
  return results;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

describe("pi-jar jar_ask relay", () => {
  it("publishes at tool start and a companion answer completes every open picker at once", async () => {
    const channel = new FakeChannel();
    const tools = new ToolDialogRelay(channel);
    const { ui } = fakeUi();
    relayDialogs(ui, channel, tools);

    tools.start("jar_ask", "call-1", jarArgs);
    assert.equal(channel.published.length, 1, "question is published before the picker opens");
    assert.deepEqual(channel.published[0]!.questions.map(q => q.question), ["Database?", "Features?"]);
    assert.equal(channel.published[0]!.questions[1]!.multiSelect, true);

    const run = jarAsk(ui, 2);
    await tick();
    channel.answer({ q1: ["SQLite"], q2: ["Auth", "Billing"] });
    assert.deepEqual(await run, [
      { kind: "answer", selected: ["SQLite"] },
      { kind: "answer", selected: ["Auth", "Billing"] }
    ]);
  });

  it("applies an answer that arrives before the picker opened", async () => {
    const channel = new FakeChannel();
    const tools = new ToolDialogRelay(channel);
    const { ui } = fakeUi();
    relayDialogs(ui, channel, tools);

    tools.start("jar_ask", "call-1", { questions: [jarArgs.questions[0]] });
    channel.answer({ q1: ["Postgres"] });
    await tick();
    assert.deepEqual(await jarAsk(ui, 1), [{ kind: "answer", selected: ["Postgres"] }]);
  });

  it("maps a companion dismissal to the tool's cancel result", async () => {
    const channel = new FakeChannel();
    const tools = new ToolDialogRelay(channel);
    const { ui } = fakeUi();
    relayDialogs(ui, channel, tools);

    tools.start("jar_ask", "call-1", { questions: [jarArgs.questions[0]] });
    const run = jarAsk(ui, 1);
    await tick();
    channel.answer(null);
    assert.deepEqual(await run, [{ kind: "cancel" }]);
  });

  it("a terminal answer withdraws the companion question when the tool ends", async () => {
    const channel = new FakeChannel();
    const tools = new ToolDialogRelay(channel);
    const { ui, open } = fakeUi();
    relayDialogs(ui, channel, tools);

    tools.start("jar_ask", "call-1", { questions: [jarArgs.questions[0]] });
    const run = jarAsk(ui, 1);
    await tick();
    open[0]!({ kind: "answer", selected: ["Postgres"] });
    assert.deepEqual(await run, [{ kind: "answer", selected: ["Postgres"] }]);
    tools.end("call-1");
    assert.equal(channel.withdrawn, 1, "the companion question is withdrawn");
  });

  it("a stale relayed tool that never ended does not block the next question", async () => {
    const channel = new FakeChannel();
    const tools = new ToolDialogRelay(channel);
    const { ui } = fakeUi();
    relayDialogs(ui, channel, tools);

    tools.start("jar_ask", "lost-call", { questions: [jarArgs.questions[0]] });
    tools.start("jar_ask", "call-2", { questions: [jarArgs.questions[1]] });
    assert.equal(channel.published.length, 2);
    assert.equal(channel.withdrawn, 1, "the stale question is withdrawn, not left hanging");
    const run = jarAsk(ui, 1);
    await tick();
    channel.answer(null); // the withdrawn first ask (already aborted)
    channel.answer({ q1: ["Auth"] });
    assert.deepEqual(await run, [{ kind: "answer", selected: ["Auth"] }]);
  });

  it("leaves other custom dialogs and unknown tools alone", async () => {
    const channel = new FakeChannel();
    const tools = new ToolDialogRelay(channel);
    const { ui, open } = fakeUi();
    relayDialogs(ui, channel, tools);

    tools.start("some_tool", "call-1", jarArgs);
    assert.equal(channel.published.length, 0);
    const run = ui.custom(() => ({}) as never);
    open[0]!("terminal");
    assert.equal(await run, "terminal");
  });
});

describe("relayed ctx.ui dialogs", () => {
  for (const dialog of dialogCases) {
    for (const completion of ["remote", "local"]) {
      it(`overlapping ${dialog.name} dialogs stay independent when the newer dialog finishes ${completion}ly`, { timeout: 2000 }, async () => {
        const channel = new FakeChannel();
        const { ui, open } = stackedDialogUi();
        relayDialogs(ui, channel, new ToolDialogRelay(channel));
        let firstSettled = false;
        const first = dialog.start(ui, "First").then(value => { firstSettled = true; return value; });
        const second = dialog.start(ui, "Second");

        let secondExpected = dialog.remoteResult;
        if (completion === "remote") {
          channel.answerAt(1, { answer: [dialog.remoteAnswer] });
        } else {
          secondExpected = dialog.localResult;
          open[1]!.answer(dialog.localResult);
        }
        assert.equal(await second, secondExpected);
        await tick();
        assert.deepEqual({
          terminalAborted: open.map(item => item.signal.aborted),
          companionAborted: channel.signals.map(signal => signal?.aborted),
          firstSettled
        }, { terminalAborted: [false, true], companionAborted: [false, true], firstSettled: false });

        let firstExpected = dialog.localResult;
        if (completion === "remote") {
          open[0]!.answer(dialog.localResult);
        } else {
          firstExpected = dialog.remoteResult;
          channel.answerAt(0, { answer: [dialog.remoteAnswer] });
        }
        assert.equal(await first, firstExpected, "the older dialog remains answerable from the other side");
        assert.deepEqual(channel.signals.map(signal => signal?.aborted), [true, true]);
      });
    }

    it(`aborting one overlapping ${dialog.name} dialog leaves the other open`, { timeout: 2000 }, async () => {
      const channel = new FakeChannel();
      const { ui, open } = stackedDialogUi();
      relayDialogs(ui, channel, new ToolDialogRelay(channel));
      const controller = new AbortController();
      const first = dialog.start(ui, "First", controller.signal);
      let secondSettled = false;
      const second = dialog.start(ui, "Second").then(value => { secondSettled = true; return value; });

      controller.abort();
      assert.equal(await first, dialog.dismissed);
      await tick();
      assert.deepEqual({
        terminalAborted: open.map(item => item.signal.aborted),
        companionAborted: channel.signals.map(signal => signal?.aborted),
        secondSettled
      }, { terminalAborted: [true, false], companionAborted: [true, false], secondSettled: false });
      channel.answerAt(1, { answer: [dialog.remoteAnswer] });
      assert.equal(await second, dialog.remoteResult);
    });
  }

  it("a companion answer resolves select() and closes the terminal dialog", async () => {
    const channel = new FakeChannel();
    const { ui } = fakeUi();
    let terminalSignal: AbortSignal | undefined;
    Object.assign(ui, {
      select: (_title: string, _options: string[], opts?: { signal?: AbortSignal }) => {
        terminalSignal = opts?.signal;
        return new Promise(() => {});
      }
    });
    relayDialogs(ui, channel, new ToolDialogRelay(channel));

    const choice = ui.select("Pick", ["a", "b"]);
    assert.equal(channel.published[0]!.source, "select");
    channel.answer({ answer: ["b"] });
    assert.equal(await choice, "b");
    assert.equal(terminalSignal?.aborted, true, "terminal dialog is dismissed");
  });

  it("ignores companion answers that are not among the options", async () => {
    const channel = new FakeChannel();
    const { ui } = fakeUi();
    relayDialogs(ui, channel, new ToolDialogRelay(channel));
    const choice = ui.select("Pick", ["a", "b"]);
    channel.answer({ answer: ["zzz"] });
    assert.equal(await choice, undefined);
  });
});
