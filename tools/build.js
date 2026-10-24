/* 실행: node tools/build.js
 * 1) js/data.js : 프로필·예시 CSV를 내장해 index.html을 더블클릭(file://)으로도 열리게 한다.
 * 2) dist/rnd-profiler.html : css·js를 모두 안에 넣은 단일 파일. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const profiles = fs.readdirSync(path.join(root, 'profiles')).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(rd('profiles', f)));
const examples = [
  { id: 'keit_2024', name: 'KEIT 산업기술 연구개발 성과조사정보 2024', profile: 'keit_performance', file: 'input_keit_2024.csv', text: rd('examples', 'input_keit_2024.csv') },
  { id: 'other_org', name: '가상 기관 (범용성 시연)', profile: 'sample_other_org', file: 'input_other_org.csv', text: rd('examples', 'input_other_org.csv') }
];
const data = '/* tools/build.js 가 만든 파일입니다. 직접 고치지 마세요. */\nwindow.BUILTIN = ' + JSON.stringify({ profiles, examples }) + ';\n';
fs.writeFileSync(path.join(root, 'js', 'data.js'), data);
let html = rd('index.html');
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => '<style>\n' + rd('css', 'style.css') + '\n</style>');
for (const s of ['data', 'core', 'charts', 'app']) {
  html = html.replace(`<script src="js/${s}.js"></script>`, () => '<script>\n' + rd('js', s + '.js').replace(/<\/script/gi, '<\\/script') + '\n</script>');
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'rnd-profiler.html'), html);
console.log('js/data.js', data.length, 'bytes; dist/rnd-profiler.html', html.length, 'bytes');
