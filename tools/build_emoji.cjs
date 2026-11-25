// 전시물에 쓰는 이모지만 Twemoji(CC-BY 4.0)에서 골라 아틀라스 한 장으로 만든다.
// 사용: node tools/build_emoji.cjs <@twemoji/svg 폴더> [sharp 모듈 경로]
// 결과: img/emoji.png (72px 칸), js/emoji-map.js (이모지 → 칸 번호)
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const svgDir = process.argv[2];
const sharp = require(process.argv[3] || "sharp");
if (!svgDir || !fs.existsSync(svgDir)) { console.error("Twemoji SVG 폴더를 지정하세요"); process.exit(1); }

const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/content.js"), "utf8"), ctx);
const set = new Set();
for (const it of ctx.MM.ITEMS) if (it.icon.startsWith("e:")) for (const e of it.icon.slice(2).split("+")) if (e) set.add(e);
// 화면 장식에 쓰는 몇 개 (역할 표시 등)
for (const e of ["🎭", "🔍", "❤️", "🖤", "📯", "🏛️", "⭐"]) set.add(e);
const list = [...set];

function twName(e) {
  const cps = [...e].map(c => c.codePointAt(0));
  const zwj = cps.includes(0x200d);
  return cps.filter(c => zwj || c !== 0xfe0f).map(c => c.toString(16)).join("-");
}
const CELL = 72, COLS = 16;
(async () => {
  const tiles = [], map = {}, missing = [];
  for (const e of list) {
    let f = path.join(svgDir, twName(e) + ".svg");
    if (!fs.existsSync(f)) { const alt = path.join(svgDir, [...e].map(c => c.codePointAt(0).toString(16)).join("-") + ".svg"); if (fs.existsSync(alt)) f = alt; else { missing.push(e + " " + twName(e)); continue; } }
    const png = await sharp(fs.readFileSync(f), { density: 300 }).resize(CELL - 4, CELL - 4, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    map[e] = tiles.length; tiles.push(png);
  }
  if (missing.length) { console.error("Twemoji에 없는 이모지:", missing.join(", ")); process.exitCode = 2; }
  const rows = Math.ceil(tiles.length / COLS);
  const composite = tiles.map((buf, i) => ({ input: buf, left: (i % COLS) * CELL + 2, top: Math.floor(i / COLS) * CELL + 2 }));
  await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(path.join(root, "img/emoji.png"));
  fs.writeFileSync(path.join(root, "js/emoji-map.js"),
    "// tools/build_emoji.cjs 가 만든 파일 — 직접 고치지 마세요. Twemoji(CC-BY 4.0) 아틀라스 img/emoji.png 의 칸 번호\n" +
    `window.EMOJI_ATLAS = { cell: ${CELL}, cols: ${COLS}, map: ${JSON.stringify(map)} };\n`);
  console.log(`이모지 ${tiles.length}개 → img/emoji.png (${COLS * CELL}×${rows * CELL})`, fs.statSync(path.join(root, "img/emoji.png")).size, "bytes");
})();
