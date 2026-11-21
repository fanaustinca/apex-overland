// Multi-view visual QA: GPU=1 node tests/views.mjs <prefix> <quality> "name|js;name|js"
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const [prefix = 'v', quality = 'high', spec = ''] = process.argv.slice(2);
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${quality}${process.env.Q || ''}`, { width: +(process.env.W || 1280), height: +(process.env.H || 720) });
for (const item of spec.split(';;').filter(Boolean)) {
  const [name, js] = item.split('|');
  await page.evaluate(js);
  await page.evaluate(() => window.AO.render(4));
  await page.screenshot({ path: path.join(shots, `${prefix}-${name}.png`) });
}
console.log('errors:', errors.filter((e) => !/CONTEXT_LOST/.test(e)).join('\n') || 'none');
await browser.close(); srv.close();
