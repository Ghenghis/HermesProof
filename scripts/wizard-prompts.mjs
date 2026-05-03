import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function createPromptSession({ inputStream = input, outputStream = output } = {}) {
  return readline.createInterface({ input: inputStream, output: outputStream });
}

export async function prompt(rl, question, defaultValue = "") {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

export async function confirm(rl, question, defaultValue = false) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

export async function pickFromList(rl, question, choices, defaultChoices = choices) {
  const labels = choices.map((choice) => choice.id || choice).join(", ");
  const defaults = defaultChoices.map((choice) => choice.id || choice).join(",");
  const answer = await prompt(rl, `${question} [${labels}]`, defaults);
  const wanted = new Set(answer.split(",").map((value) => value.trim()).filter(Boolean));
  return choices.filter((choice) => wanted.has(choice.id || choice));
}

export async function pathWithCompletion(rl, question, defaultValue = "") {
  return await prompt(rl, question, defaultValue);
}
