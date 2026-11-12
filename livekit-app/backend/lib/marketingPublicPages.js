const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { consentDatabase } = require('./consent');
const { authority } = require('./marketingAuthority');

const staticRoot = () => path.resolve(process.env.MARKETING_STATIC_ROOT || path.join(__dirname,'../../frontend'));
const fingerprint = row => createHash('sha256').update(JSON.stringify(Object.keys(row).sort().map(key => [key,row[key]]))).digest('hex');
const published = () => consentDatabase.all("SELECT * FROM mkt_posts WHERE tenant_id='lalia' AND status='published' ORDER BY id");

async function ensureStaticBaseline() {
  await consentDatabase.run('CREATE TABLE IF NOT EXISTS mkt_static_baseline (slug TEXT PRIMARY KEY, post_id TEXT NOT NULL, fingerprint TEXT NOT NULL)');
}

async function captureStaticBaseline() {
  await ensureStaticBaseline();
  for (const row of await published()) {
    await consentDatabase.run('INSERT INTO mkt_static_baseline(slug,post_id,fingerprint) VALUES (?,?,?) ON CONFLICT (slug) DO NOTHING',[row.slug,row.id,fingerprint(row)]);
  }
}

async function managesPublishedPages() {
  const current = await authority();
  return current?.mode === 'cache' || Number(current?.generation) > 1;
}

function serveFile(res,file) {
  if (!fs.existsSync(file)) return false;
  res.sendFile(file);
  return true;
}

function publicMarketingHandlers(kit) {
  return {
    async blogIndex(req,res,next) {
      try {
        let useStatic = !(await managesPublishedPages());
        if (!useStatic) {
          const baseline = new Map((await consentDatabase.all('SELECT slug,fingerprint FROM mkt_static_baseline')).map(row => [row.slug,row.fingerprint]));
          const posts = await published();
          useStatic = baseline.size === posts.length && posts.every(post => baseline.get(post.slug) === fingerprint(post));
        }
        if (useStatic && serveFile(res,path.join(staticRoot(),'blog/index.html'))) return;
        return kit.publicHandlers.blogIndex(req,res,next);
      } catch (error) { return next(error); }
    },
    async blogPost(req,res,next) {
      try {
        const slug = req.params.slug;
        if (!/^[a-z0-9-]+$/.test(slug)) return kit.publicHandlers.blogPost(req,res,next);
        let useStatic = true;
        if (await managesPublishedPages()) {
          const post = await consentDatabase.get("SELECT * FROM mkt_posts WHERE tenant_id='lalia' AND slug=?",[slug]);
          const original = await consentDatabase.get('SELECT post_id,fingerprint FROM mkt_static_baseline WHERE slug=?',[slug]);
          if (post) {
            useStatic = post.status === 'published' && original?.fingerprint === fingerprint(post);
          } else if (original) {
            const moved = await consentDatabase.get("SELECT slug FROM mkt_posts WHERE tenant_id='lalia' AND id=? AND status='published'",[original.post_id]);
            if (moved) return res.redirect(301,`/blog/${encodeURIComponent(moved.slug)}`);
            useStatic = false;
          }
        }
        if (useStatic && serveFile(res,path.join(staticRoot(),'blog',slug,'index.html'))) return;
        return kit.publicHandlers.blogPost(req,res,next);
      } catch (error) { return next(error); }
    },
    async sitemap(req,res,next) {
      try {
        const file = path.join(staticRoot(),'sitemap.xml');
        if (!fs.existsSync(file)) return kit.publicHandlers.sitemap(req,res,next);
        if (!(await managesPublishedPages())) { res.sendFile(file); return; }
        const all = new Map((await consentDatabase.all("SELECT slug,status FROM mkt_posts WHERE tenant_id='lalia'")).map(row => [row.slug,row.status]));
        for (const { slug } of await consentDatabase.all('SELECT slug FROM mkt_static_baseline')) if (!all.has(slug)) all.set(slug,'moved');
        const found = new Set();
        const origin = 'https://lalia.cloud';
        const raw = fs.readFileSync(file,'utf8').replace(/<url>[\s\S]*?<\/url>/g, block => {
          const url = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
          if (!url?.startsWith(`${origin}/blog/`)) return block;
          const slug = url.slice(`${origin}/blog/`.length).replace(/\/$/,'');
          found.add(slug);
          return all.has(slug) && all.get(slug) !== 'published' ? '' : block;
        });
        const additions = [...all].filter(([slug,status]) => status === 'published' && !found.has(slug))
          .map(([slug]) => `<url><loc>${origin}/blog/${encodeURIComponent(slug)}</loc></url>`).join('\n');
        return res.type('application/xml').send(raw.replace('</urlset>',`${additions}\n</urlset>`));
      } catch (error) { return next(error); }
    },
  };
}

module.exports = { ensureStaticBaseline, captureStaticBaseline, publicMarketingHandlers };
