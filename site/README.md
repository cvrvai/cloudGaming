# CloudKH public site

This is deliberately separate from `frontend/`, which is the local phone
controller and must not be deployed to the public internet.

## Deploy on Cloudflare Pages

1. In Cloudflare, add `cloudkh.space` and change its Namecheap nameservers to
   the two nameservers Cloudflare gives you.
2. Create a **Pages** project from this repository.
3. Use these build settings:
   - Framework preset: `None`
   - Build command: *(leave empty)*
   - Build output directory: `site`
4. In Pages → Custom domains, add `cloudkh.space` and `www.cloudkh.space`.
   Make `cloudkh.space` the primary domain and redirect `www` to it.
5. Before sharing the site, configure Cloudflare Email Routing for
   `hello@cloudkh.space` to forward to an inbox you own. The landing page's
   beta-access button opens that address.

Cloudflare will create the HTTPS certificate after DNS becomes active. Do not
publish the `backend/` or `frontend/` directories with this Pages project.
