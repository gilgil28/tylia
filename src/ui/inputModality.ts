// Whether the user last used the keyboard or a pointer. `:focus-visible` can't tell: focus
// that a closing menu hands back to its button counts as visible even after a mouse click.

let lastInput: "keyboard" | "pointer" = "pointer";

if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (lastInput = "keyboard"), true);
  window.addEventListener("pointerdown", () => (lastInput = "pointer"), true);
}

export const lastInputWasKeyboard = () => lastInput === "keyboard";
