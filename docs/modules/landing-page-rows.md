# Landing page rows (for the "landing page" sheet tab)

This is the content for the **`landing page`** tab (columns: `section`,
`content`, `assets`). Paste each row below into its own sheet row, in the
order shown - rows render top to bottom, and together with
[`home.html`](/docs/modules/home.html) (pasted into the `Modules` tab's
`home` row) they build the full marketing page.

Replace the placeholder image URLs in the **Hero** and **Gallery** rows'
`assets` with your own photos (e.g. links into your
[Drive assets folder](https://drive.google.com/drive/u/0/folders/1bmhfpUcjtlAdJEw9uXD3VlWJKXO5A-CA))
before going live - the ones below are temporary stand-ins so the page
isn't broken while empty.

Placeholder syntax available in `content`: `{{asset:0}}` (full embed tag),
`{{assetUrl:0}}` (just the resolved URL), `{{assets:grid}}` (every asset in
that row, rendered as a responsive grid) - see comments at the top of
`home.html` for details.

The logo, phone number, "Get a Free Quote", and "Login" buttons are fixed,
static markup in `index.html` (not sheet-driven). The **Masthead** row
below is just the in-page menu bar that renders at the top of the page
body - add/remove/reorder its links here without touching code. It's
fully self-contained (its own `<style>`/`<script>`), fixed in position
right below the shell header (measured dynamically, so it still lines up
correctly if the header's height changes, e.g. wrapping on narrow
screens), with a spacer so it doesn't overlap the Hero section under it.

---

## Row 1 — section: `Masthead`

**content:**
```html
<div class="rg-menu-spacer" id="rg-menu-spacer"></div>
<div class="rg-menu-bar" id="rg-menu-bar">
  <button type="button" class="rg-menu-link" data-scroll-to="lp-services">Services</button>
  <button type="button" class="rg-menu-link" data-scroll-to="lp-how-it-works">How It Works</button>
  <button type="button" class="rg-menu-link" data-scroll-to="lp-testimonials">Reviews</button>
  <button type="button" class="rg-menu-link" data-scroll-to="lp-faq">FAQ</button>
</div>

<style>
  .rg-menu-bar {
    position: fixed;
    top: 64px;
    left: 0;
    right: 0;
    z-index: 25;
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    padding: 0.55rem 1rem;
  }
  .rg-menu-link {
    background: none;
    border: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    color: #475569;
    cursor: pointer;
    padding: 0;
  }
  .rg-menu-link:hover { color: #0b5fa5; }
</style>

<script>
(function () {
  var bar = document.getElementById('rg-menu-bar');
  var spacer = document.getElementById('rg-menu-spacer');
  if (!bar || !spacer) return;

  function layout() {
    var header = document.getElementById('site-header');
    bar.style.top = (header ? header.offsetHeight : 0) + 'px';
    spacer.style.height = bar.offsetHeight + 'px';
  }

  layout();
  window.addEventListener('resize', layout);
})();
</script>
```

**assets:** `[]`

---

## Row 2 — section: `Hero`

**content:**
```html
<section class="lp-hero" id="lp-hero" style="background-image: url('{{assetUrl:0}}');">
  <div class="lp-container lp-hero-inner">
    <h1>Protect Your Home From Clogged Gutters, For Good.</h1>
    <p>Gutter Guys of Katy installs premium gutter guards and seamless gutters that keep debris out and water flowing - backed by a lifetime warranty and a free, no-pressure inspection.</p>
    <div class="lp-hero-ctas">
      <a class="lp-btn lp-btn-primary" href="#rfq">Get My Free Quote</a>
      <button type="button" class="lp-btn lp-btn-outline" data-scroll-to="lp-how-it-works">See How It Works</button>
    </div>
  </div>
</section>
```

**assets:**
```json
["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1600"]
```

---

## Row 3 — section: `Trust Bar`

**content:**
```html
<section class="lp-trust-bar">
  <div class="lp-container lp-trust-grid">
    <div><div class="lp-trust-number">15+</div><div class="lp-trust-label">Years in Business</div></div>
    <div><div class="lp-trust-number">5,000+</div><div class="lp-trust-label">Homes Protected</div></div>
    <div><div class="lp-trust-number">Lifetime</div><div class="lp-trust-label">Warranty</div></div>
    <div><div class="lp-trust-number">A+</div><div class="lp-trust-label">BBB Rating</div></div>
  </div>
</section>
```

**assets:** `[]`

---

## Row 4 — section: `Services`

**content:**
```html
<section class="lp-section" id="lp-services">
  <div class="lp-container">
    <div class="lp-section-head">
      <div class="lp-eyebrow">What We Offer</div>
      <h2>Complete Gutter Protection Services</h2>
      <p>From first install to lifetime maintenance, we handle every part of keeping your gutters clear and your home protected.</p>
    </div>
    <div class="lp-services-grid">
      <div class="lp-service-card">
        <span class="lp-service-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="6" rx="1.5"/><path d="M6.5 8v6M10.5 8v6M14.5 8v6M18.5 8v6" stroke-width="1"/></svg></span>
        <h3>Gutter Guards</h3>
        <p>Micro-mesh guards that block leaves and debris while letting water flow freely, rain or shine.</p>
      </div>
      <div class="lp-service-card">
        <span class="lp-service-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M12 3c1 1.3 2 2.6 2 3.8a2 2 0 1 1-4 0C10 5.6 11 4.3 12 3z"/></svg></span>
        <h3>Seamless Gutters</h3>
        <p>Custom-fit, seamless aluminum gutters built on-site to match your home - no leaky joints.</p>
      </div>
      <div class="lp-service-card">
        <span class="lp-service-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4z"/></svg></span>
        <h3>Repairs</h3>
        <p>Sagging, leaking, or pulling away from the roofline? We'll fix it fast and reinforce it for the long run.</p>
      </div>
      <div class="lp-service-card">
        <span class="lp-service-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21s3-1 5-3 10-10 10-10l2 2S10 20 8 18 3 21 3 21z"/><path d="m14 6 4 4"/></svg></span>
        <h3>Cleaning &amp; Maintenance</h3>
        <p>One-time cleanouts or scheduled maintenance plans to keep older gutters flowing freely.</p>
      </div>
    </div>
  </div>
</section>
```

**assets:** `[]`

---

## Row 5 — section: `How It Works`

**content:**
```html
<section class="lp-section lp-section-alt" id="lp-how-it-works">
  <div class="lp-container">
    <div class="lp-section-head">
      <div class="lp-eyebrow">Our Process</div>
      <h2>Protected In Four Easy Steps</h2>
      <p>No pressure, no surprises - just a clear path from first call to lifetime protection.</p>
    </div>
    <div class="lp-steps-grid">
      <div class="lp-step"><div class="lp-step-number">1</div><h3>Free Inspection</h3><p>We assess your roofline and gutters and answer every question, at no cost.</p></div>
      <div class="lp-step"><div class="lp-step-number">2</div><h3>Custom Quote</h3><p>Get transparent, upfront pricing matched to your home's exact needs.</p></div>
      <div class="lp-step"><div class="lp-step-number">3</div><h3>Pro Installation</h3><p>Our certified crews install cleanly and efficiently, usually in a single day.</p></div>
      <div class="lp-step"><div class="lp-step-number">4</div><h3>Lifetime Protection</h3><p>Enjoy clog-free gutters backed by our lifetime warranty for as long as you own your home.</p></div>
    </div>
  </div>
</section>
```

**assets:** `[]`

---

## Row 6 — section: `Gallery`

**content:**
```html
<section class="lp-section" id="lp-gallery">
  <div class="lp-container">
    <div class="lp-section-head">
      <div class="lp-eyebrow">Recent Work</div>
      <h2>See the Gutter Guys of Katy Difference</h2>
      <p>A few recent installs from homes just like yours.</p>
    </div>
    {{assets:grid}}
  </div>
</section>
```

**assets:** (drop in as many photo links as you like - this row uses
`{{assets:grid}}`, so the count doesn't need to match anything in the HTML)
```json
[
  "https://images.unsplash.com/photo-1558036117-15d82a90b9b1?q=80&w=900",
  "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?q=80&w=900",
  "https://images.unsplash.com/photo-1602941525421-8f8b81d3edbb?q=80&w=900"
]
```

---

## Row 7 — section: `Testimonials`

**content:**
```html
<section class="lp-section lp-section-alt" id="lp-testimonials">
  <div class="lp-container">
    <div class="lp-section-head">
      <div class="lp-eyebrow">Customer Stories</div>
      <h2>Trusted By Homeowners Like You</h2>
    </div>
    <div class="lp-testimonial-grid">
      <div class="lp-testimonial-card">
        <div class="lp-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <blockquote>"Haven't cleaned my gutters once since Gutter Guys of Katy installed their guards two years ago. Worth every penny."</blockquote>
        <div class="lp-testimonial-name">Daniel R.</div>
        <div class="lp-testimonial-location">Katy, TX</div>
      </div>
      <div class="lp-testimonial-card">
        <div class="lp-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <blockquote>"Crew was fast, clean, and polite. The quote matched the final bill exactly - no surprises."</blockquote>
        <div class="lp-testimonial-name">Maria S.</div>
        <div class="lp-testimonial-location">Richmond, TX</div>
      </div>
      <div class="lp-testimonial-card">
        <div class="lp-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
        <blockquote>"After a bad storm took out our old gutters, Gutter Guys of Katy had new seamless gutters up within a week."</blockquote>
        <div class="lp-testimonial-name">Tom K.</div>
        <div class="lp-testimonial-location">Sugar Land, TX</div>
      </div>
    </div>
  </div>
</section>
```

**assets:** `[]`

---

## Row 8 — section: `FAQ`

**content:**
```html
<section class="lp-section" id="lp-faq">
  <div class="lp-container">
    <div class="lp-section-head">
      <div class="lp-eyebrow">Questions</div>
      <h2>Frequently Asked Questions</h2>
    </div>
    <div class="lp-faq-list">
      <details class="lp-faq-item">
        <summary>How long does installation take?<svg class="lp-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></summary>
        <p>Most homes are completed in a single day. Larger or multi-story homes may take a day and a half.</p>
      </details>
      <details class="lp-faq-item">
        <summary>Do your gutter guards really stop all debris?<svg class="lp-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></summary>
        <p>Our micro-mesh guards block leaves, pine needles, and shingle grit while still handling heavy rainfall.</p>
      </details>
      <details class="lp-faq-item">
        <summary>What does the warranty cover?<svg class="lp-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></summary>
        <p>Every install includes a lifetime, transferable warranty on materials and workmanship.</p>
      </details>
      <details class="lp-faq-item">
        <summary>Is the inspection really free?<svg class="lp-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></summary>
        <p>Yes - no cost, no pressure. We'll give you honest recommendations even if that means doing nothing.</p>
      </details>
    </div>
  </div>
</section>
```

**assets:** `[]`

---

## Row 9 — section: `CTA Banner`

**content:**
```html
<section class="lp-cta-banner">
  <div class="lp-container">
    <h2>Ready to Never Clean Your Gutters Again?</h2>
    <p>Get a free, no-pressure quote in minutes.</p>
    <a class="lp-btn lp-btn-primary" href="#rfq">Get My Free Quote</a>
  </div>
</section>
```

**assets:** `[]`

---

## Row 10 — section: `Footer`

**content:**
```html
<footer class="lp-footer">
  <div class="lp-container">
    <div class="lp-footer-grid">
      <div>
        <div class="lp-footer-brand">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-5h6v5"/></svg>
          Gutter Guys of Katy
        </div>
        <p>Gutter guards, seamless gutters, repairs, and cleaning - backed by a lifetime warranty.</p>
        <div class="lp-footer-social">
          <a href="#" aria-label="Facebook"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V7a2 2 0 0 1 2-2h2V2h-3a5 5 0 0 0-5 5v2H8v3h2v9h4v-9h3l1-3h-4z"/></svg></a>
          <a href="#" aria-label="Instagram"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>
        </div>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><button type="button" class="lp-nav-link" data-scroll-to="lp-services">Services</button></li>
          <li><button type="button" class="lp-nav-link" data-scroll-to="lp-how-it-works">How It Works</button></li>
          <li><button type="button" class="lp-nav-link" data-scroll-to="lp-testimonials">Reviews</button></li>
          <li><button type="button" class="lp-nav-link" data-scroll-to="lp-faq">FAQ</button></li>
        </ul>
      </div>
      <div>
        <h4>Get Started</h4>
        <ul>
          <li><a href="#rfq">Get a Free Quote</a></li>
          <li><a href="tel:+18005551234">(800) 555-1234</a></li>
          <li><a href="mailto:hello@gutterguysofkaty.example">hello@gutterguysofkaty.example</a></li>
        </ul>
      </div>
    </div>
    <div class="lp-footer-bottom">&copy; <span id="lp-footer-year"></span> Gutter Guys of Katy. All rights reserved.</div>
  </div>
</footer>
<script>document.getElementById('lp-footer-year').textContent = new Date().getFullYear();</script>
```

**assets:** `[]`
