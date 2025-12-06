# Webflow Notion Headless

A hybrid headless setup that allows you to design in Webflow, write in Notion, and serve everything via Cloudflare Workers using server-side rendering (HTMLRewriter).

This is the source code behind [sil.so](https://sil.so/). For the full backstory and architecture breakdown, [read the blog post here](https://sil.so/blog/headless-blog-webflow-notion-cloudflare).

## Features

- 🎨 **Webflow for Design:** Complete visual control without coding the UI.
- 📝 **Notion as CMS:** A seamless writing experience.
- ⚡ **Cloudflare Workers:** Server-side rendering (no client-side loading spinners).
- 🚀 **KV Caching:** Sub-50ms load times after the first hit.
- 🔍 **Automatic SEO:** Auto-generates JSON-LD Schema, Open Graph tags, and Twitter cards.

## Prerequisites

1.  **Cloudflare Account** (Free tier works).
2.  **Notion Account** with a created Integration.
3.  **FlowTube Extension** (for syncing Webflow code to GitHub).

## Setup Guide

### 1. Database Setup

1.  Duplicate this [Notion Template](https://sil-so.notion.site/webflow-notion-headless).
2.  Create an Internal Integration at [Notion My Integrations](https://www.notion.so/profile/integrations).
3.  Give the integration access to the specific database you just duplicated.
4.  Copy your **Internal Integration Secret** (API Key).

### 2. Webflow Configuration

You need to add specific attributes to your Webflow elements so the Worker knows where to inject content.

#### Blog List Page (`/blog`)
Design a static list with one item (an article card). Add these attributes:

| Element | Attribute |
| :--- | :--- |
| **Article Wrapper** | `data-template="item"` |
| **Title Text** | `data-bind="title"` |
| **Date Text** | `data-bind="date"` |
| **Link Block** | `data-bind="link"` |
| **Image** | `data-bind="image"` |

#### Blog Post Page (`/blog-post`)
Design the skeleton of your post. Add these IDs:

| Element | ID |
| :--- | :--- |
| **H1 Heading** | `post-title` |
| **Date Text** | `post-published` |
| **Rich Text** | `post-content` |
| **Cover Image** | `post-banner` |

#### SEO & Scripts

**1. Schema Tag:**
Add this to the `<head>` of **both** pages (Custom Code section) for automatic SEO injection:

```html
<script type="application/ld+json"></script>
```

**2. Active State Script:**
Add this to the `<body>` footer of the **Blog Post** page to highlight the "Blog" nav link when reading a post:

```html
<script>
(function(){
  function fixBlogNav() {
    document.querySelectorAll('a.nav-link').forEach(function(link) {
      var href = link.getAttribute('href') || '';
      if (href === '/blog' || href === '/blog/' || href.indexOf('blog') > -1 && href.indexOf('blog/') === -1) {
        link.classList.add('w--current');
        link.setAttribute('aria-current', 'page');
      }
    });
  }
  if (document.readyState === 'complete') { setTimeout(fixBlogNav, 0); } 
  else { window.addEventListener('load', function() { setTimeout(fixBlogNav, 0); }); }
})();
</script>
```

### 3. Worker Configuration

1.  **Clone this repo.**
2.  **Edit `worker.js`:** Update the `SITE_CONFIG` object at the top with your details (Domain, Name, Socials).
3.  **Setup KV Storage:**
    *   In Cloudflare Dashboard: **Workers & Pages** -> **KV**.
    *   Create namespace `BLOG_CACHE`.
    *   Copy the ID and paste it into `wrangler.jsonc`:

```json
"kv_namespaces": [
    {
      "binding": "BLOG_CACHE",
      "id": "PASTE_YOUR_ID_HERE"
    }
]
```

### 4. Deployment

1.  Go to Cloudflare Dashboard -> **Workers & Pages**.
2.  Create Application -> Connect to GitHub -> Select this repo.
3.  Set the **Deploy command**: `npx wrangler deploy --env production`
4.  **Add Secrets:**
    Once the project is created, go to **Settings** -> **Variables and Secrets** and add:
    *   `NOTION_API_KEY`: Your Notion Integration Secret.
    *   `NOTION_DB_BLOG_ID`: The ID from your Notion Database URL (the 32-character string before the `?`).

## Usage

### Refreshing Content
The site uses KV caching to stay fast. Changes in Notion won't appear immediately. To force an update, append `?refresh=true` to any URL.

Example: `https://yourdomain.com/blog/my-post?refresh=true`

## License

[MIT](https://opensource.org/licenses/MIT)
