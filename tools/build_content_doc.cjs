// js/content.js 를 읽어 교사 검토용 목록 docs/content.md 를 만든다: node tools/build_content_doc.cjs
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/content.js"), "utf8"), ctx);
const { MM } = ctx;
let out = `# 전시 콘텐츠 검토표\n\n` +
  `\`js/content.js\`에서 자동으로 만든 목록입니다(\`node tools/build_content_doc.cjs\`). 단원 ${MM.UNITS.length}개 · 전시동 ${MM.WINGS.length}개 · 전시실 ${MM.ROOMS.length}개 · 전시물 ${MM.ITEMS.length}개.\n\n` +
  `- **전시실 = 범주, 전시물 = 그 범주의 사례.** 미믹은 자기 전시물이 있어야 할 전시실의 빈 받침대에 숨어야 들키지 않습니다. 이 표가 곧 정답표라서, 여기 틀린 게 있으면 게임이 틀린 걸 가르칩니다.\n` +
  `- 고칠 게 있으면 \`js/content.js\`에서 해당 줄의 이름·전시실을 바꾸거나 빼면 됩니다. 덧붙임 설명은 잡혔을 때와 오답 노트에 나옵니다.\n` +
  `- **같이 못 나오는 전시동**: 정답이 둘이 될 수 있는 전시동끼리는 같은 라운드에 나오지 않게 막아 두었습니다(예: 순물질·혼합물 ↔ 원소·화합물, 상태 변화 ↔ 물리·화학 변화).\n` +
  `- 학년은 2022 개정 교과서 기준으로 묶었습니다. 학교 교과서 순서와 다르면 대기실에서 단원을 하나씩 켜고 끄면 됩니다.\n\n`;
for (const g of [1, 2, 3]) {
  out += `## ${g}학년 단원\n\n`;
  for (const u of MM.UNITS.filter(u => u.grade === g)) {
    out += `### ${u.name}\n\n`;
    for (const w of u.wings) {
      out += `**전시동: ${w.name}**` + (w.conflicts.length ? ` — 같이 안 나옴: ${w.conflicts.map(c => MM.WING_BY_ID[c].name).join(", ")}` : "") + `\n\n`;
      out += `| 전시실 | 전시물 |\n|---|---|\n`;
      for (const r of w.rooms) out += `| **${r.name}**<br><small>${r.desc}</small> | ${r.items.map(it => it[0] + (it[2] ? ` <small>(${it[2]})</small>` : "")).join(" · ")} |\n`;
      out += `\n`;
    }
  }
}
fs.writeFileSync(path.join(root, "docs/content.md"), out);
console.log("docs/content.md", out.length, "chars");
