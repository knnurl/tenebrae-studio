// Builds index.html (the studio) and tutorial.html from src/.
// The studio's scripts are inlined so index.html runs on its own, with no server and no dependencies.
// Usage: node tools/build.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), src = f => fs.readFileSync(path.join(root, "src", f), "utf8");
const strip = s => s.replace(/\nif \(typeof module[\s\S]*$/, "\n");
const js = ["core.js", "state.js", "render.js"].map(f => strip(src(f))).join("\n") + "\n" + src("ui.js");
const html = src("template.html").replace("/*CORE*/", () => js);
fs.writeFileSync(path.join(root, "index.html"), html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB`);
const tut = src("tutorial.html").replace(/\{\{TOOL\}\}/g, "./");
fs.writeFileSync(path.join(root, "tutorial.html"), tut);
console.log(`tutorial.html: ${(tut.length / 1024).toFixed(0)} KB`);
