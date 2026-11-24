const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createSeoSchemaHost, injectSeoSchema, seoPagePath } = require('@rhule/ops-sdk');

const schemaHost = createSeoSchemaHost('lalia', path.join(__dirname, '../uploads/.seo-schema.json'));
const staticRoot = () => path.resolve(process.env.MARKETING_STATIC_ROOT || path.join(__dirname, '../../frontend'));

async function serveSeoHtml(req, res, next, file) {
  const schema = schemaHost.get(req.path);
  if (!schema) {
    return res.sendFile(file, { cacheControl: false }, error => {
      if (error?.status === 404) res.sendStatus(404);
      else if (error) next(error);
    });
  }
  try {
    const html = await readFile(file, 'utf8');
    return res.type('html').send(injectSeoSchema(html, schema));
  } catch (error) {
    if (error.code === 'ENOENT') return res.sendStatus(404);
    return next(error);
  }
}

function serveStaticMarketingPage(req, res, next) {
  let target;
  try { target = seoPagePath('lalia', req.path); }
  catch { return next(); }
  if (target !== '/' && !req.path.endsWith('/') && !req.path.endsWith('/index.html')) {
    const queryIndex = req.originalUrl.indexOf('?');
    return res.redirect(301, target + '/' + (queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex)));
  }
  res.set('Cache-Control', 'no-store');
  return serveSeoHtml(req, res, next, path.join(staticRoot(), target, 'index.html'));
}

module.exports = { schemaHost, serveSeoHtml, serveStaticMarketingPage };
