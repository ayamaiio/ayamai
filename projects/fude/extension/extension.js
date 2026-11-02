// ayamai for VS Code — one command, one question, the model on this machine.
const vscode = require("vscode");

const channel = vscode.window.createOutputChannel("ayamai");

function settings() {
  const config = vscode.workspace.getConfiguration("ayamai");
  return { token: config.get("token") ?? "", door: config.get("door") ?? "http://localhost:25222" };
}

async function post(intent, input) {
  const { token, door } = settings();
  if (!token) throw new Error("set ayamai.token first (see the command palette: ayamai: ask about selection)");
  const response = await fetch(`${door}/agent/task`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ayamai-token": token },
    body: JSON.stringify({ intent, input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `agent said ${response.status}`);
  return body;
}

function activate(context) {
  context.subscriptions.push(channel);

  context.subscriptions.push(vscode.commands.registerCommand("ayamai.ask", async () => {
    const editor = vscode.window.activeTextEditor;
    const selection = editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : editor?.document.getText().slice(0, 6000);

    const question = await vscode.window.showInputBox({
      prompt: "ask ayamai about this",
      placeHolder: "explain it, find the bug, rename it…",
    });
    if (!question) return;
    if (!selection) { vscode.window.showWarningMessage("nothing selected and the file is empty"); return; }

    const language = editor?.document.languageId ?? "text";
    channel.show(true);
    channel.appendLine(`> ${question}`);

    try {
      const result = await post("llm.prompt", {
        prompt: `Language: ${language}\n\n\`\`\`${language}\n${selection}\n\`\`\`\n\n${question}`,
      });
      channel.appendLine(result.result?.text ?? result.result?.error ?? "no answer");
    } catch (error) {
      channel.appendLine(`error: ${error.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("ayamai.status", async () => {
    channel.show(true);
    try {
      const result = await post("project.status", {});
      channel.appendLine(JSON.stringify(result.result, null, 2));
    } catch (error) {
      channel.appendLine(`error: ${error.message}`);
    }
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
