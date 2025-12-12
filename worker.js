/**
 * SITE CONFIGURATION
 * Edit these values to match your Webflow site and personal details.
 */
const SITE_CONFIG = {
  name: "Your Site Name",
  domain: "https://yourdomain.com",
  author: {
    name: "Your Full Name",
    url: "https://yourdomain.com/about"
  },
  socials: [
    "https://x.com/yourhandle",
    "https://www.linkedin.com/in/yourhandle/",
    "https://bsky.app/profile/yourhandle",
    "https://www.instagram.com/yourhandle/",
    "https://threads.com/@yourhandle",
    "https://github.com/yourhandle"
  ],
  blogRoute: "/blog",
  locale: "en-US",
  timeZone: "Europe/Amsterdam",
  // Options: "prism", "okaidia", "tomorrow", "solarizedlight", "twilight", "coy"
  syntaxTheme: "okaidia"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle Blog Index
    if (
      url.pathname === SITE_CONFIG.blogRoute ||
      url.pathname === `${SITE_CONFIG.blogRoute}/`
    ) {
      return handleBlogList(request, env);
    }

    // 2. Handle Individual Blog Posts
    if (
      url.pathname.startsWith(`${SITE_CONFIG.blogRoute}/`) &&
      url.pathname.split("/").length > 2
    ) {
      const slug = url.pathname.split("/")[2];
      if (slug) return handleBlogPost(slug, request, env);
    }

    // 3. Handle Static Assets
    return await env.ASSETS.fetch(request);
  }
};

/**
 * Route: Blog Listing
 */
async function handleBlogList(request, env) {
  const url = new URL(request.url);
  const templateReq = new Request(new URL("/blog.html", request.url));
  const templateRes = await env.ASSETS.fetch(templateReq);

  if (!templateRes.ok)
    return new Response("Blog Template Not Found", { status: 404 });

  const cloneRes = templateRes.clone();
  const templateHtml = await extractTemplateRobust(cloneRes);
  if (!templateHtml)
    return new Response("Error: data-template='item' not found", {
      status: 500
    });

  const shouldRefresh = url.searchParams.get("refresh") === "true";

  try {
    const posts = await getNotionPosts(env, shouldRefresh);
    let generatedListHtml = "";

    for (const post of posts) {
      generatedListHtml += await populateTemplate(templateHtml, post);
    }

    const fullHtml = await templateRes.text();
    const response = new Response(fullHtml, {
      headers: { "Content-Type": "text/html" }
    });

    return new HTMLRewriter()
      .on("link[href]", new AssetPathHandler("href"))
      .on("script[src]", new AssetPathHandler("src"))
      .on("img[src]", new AssetPathHandler("src"))
      .on("img[srcset]", new SrcSetHandler())
      .on("a[href]", new LinkHandler())
      .on("#blog-list", {
        element(el) {
          el.setInnerContent(generatedListHtml, { html: true });
        }
      })
      .on(
        'script[type="application/ld+json"]',
        new BlogListSchemaHandler(
          posts,
          `${url.origin}${SITE_CONFIG.blogRoute}`
        )
      )
      .transform(response);
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}

/**
 * Route: Individual Post
 */
async function handleBlogPost(slug, request, env) {
  const url = new URL(request.url);
  const templateReq = new Request(new URL("/blog-post.html", request.url));
  const templateRes = await env.ASSETS.fetch(templateReq);

  if (!templateRes.ok)
    return new Response("Post Template Not Found", { status: 404 });

  const shouldRefresh = url.searchParams.get("refresh") === "true";

  try {
    const post = await getNotionPostBySlug(slug, env, shouldRefresh);
    if (!post) return new Response("Post Not Found", { status: 404 });

    // Continue Reading Logic
    let continueReadingHtml = "";
    try {
      const listReq = new Request(new URL("/blog.html", request.url));
      const listRes = await env.ASSETS.fetch(listReq);
      if (listRes.ok) {
        const itemTemplate = await extractTemplateRobust(listRes.clone());
        if (itemTemplate) {
          const allPosts = await getNotionPosts(env, false);
          const otherPosts = allPosts
            .filter((p) => p.slug !== slug)
            .slice(0, 3);
          for (const otherPost of otherPosts) {
            continueReadingHtml += await populateTemplate(
              itemTemplate,
              otherPost
            );
          }
        }
      }
    } catch (e) {
      console.error("Continue reading error", e);
    }

    const datePublished = new Date(post.date);
    const dateUpdated = post.updated ? new Date(post.updated) : datePublished;
    const metaTitle = `${post.title} | Blog | ${SITE_CONFIG.name}`;

    return (
      new HTMLRewriter()
        .on("link[href]", new AssetPathHandler("href"))
        .on("script[src]", new AssetPathHandler("src"))
        .on("img[src]", new AssetPathHandler("src"))
        .on("img[srcset]", new SrcSetHandler())
        .on("a[href]", new LinkHandler())
        // Syntax Highlighter & Clipboard Logic
        .on("head", new PrismHeadHandler(SITE_CONFIG.syntaxTheme))
        .on("body", new PrismBodyHandler())
        // SEO & Meta
        .on("title", new TextHandler(metaTitle))
        .on(
          'meta[name="description"]',
          new AttributeHandler("content", post.description)
        )
        .on(
          'meta[property="og:title"]',
          new AttributeHandler("content", metaTitle)
        )
        .on(
          'meta[property="og:description"]',
          new AttributeHandler("content", post.description)
        )
        .on(
          'meta[property="og:image"]',
          new AttributeHandler("content", post.cover)
        )
        .on(
          'meta[name="twitter:image"]',
          new AttributeHandler("content", post.cover)
        )
        .on('link[rel="canonical"]', new AttributeHandler("href", url.href))
        .on(
          'script[type="application/ld+json"]',
          new SchemaHandler(
            post,
            datePublished.toISOString(),
            dateUpdated.toISOString(),
            url.href,
            post.description
          )
        )
        // Content
        .on("#post-title", new TextHandler(post.title))
        .on(
          "#post-published",
          new DateAttributeHandler(
            datePublished.toLocaleDateString(SITE_CONFIG.locale, {
              day: "numeric",
              month: "long",
              year: "numeric"
            }),
            datePublished.toISOString()
          )
        )
        .on(
          "#post-updated",
          new DateAttributeHandler(
            dateUpdated.toLocaleDateString(SITE_CONFIG.locale, {
              day: "numeric",
              month: "long",
              year: "numeric"
            }),
            dateUpdated.toISOString()
          )
        )
        .on("#post-banner img", new ImageHandler(post.cover, post.title))
        .on("#post-content", new TextHandler(post.contentHtml, true))
        // Continue Reading Section
        .on("#continue-reading-list", {
          element(el) {
            if (continueReadingHtml)
              el.setInnerContent(continueReadingHtml, { html: true });
            else el.setAttribute("style", "display: none;");
          }
        })
        .on("#continue-reading-section", {
          element(el) {
            if (!continueReadingHtml)
              el.setAttribute("style", "display: none;");
          }
        })
        .transform(templateRes)
    );
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}

/**
 * Notion API Interaction
 */
async function getNotionPosts(env, forceRefresh = false) {
  const cacheKey = "notion_posts_list";
  if (!forceRefresh) {
    const cached = await env.BLOG_CACHE.get(cacheKey, { type: "json" });
    if (cached) return cached;
  }

  const results = await collectPaginatedAPI(
    `https://api.notion.com/v1/databases/${env.NOTION_DB_BLOG_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      }
    },
    {
      filter: { property: "Status", select: { equals: "Published" } },
      sorts: [{ property: "PublishedDate", direction: "descending" }],
      page_size: 100
    }
  );

  const posts = results.map((page) => ({
    id: page.id,
    title: page.properties.Name?.title[0]?.plain_text || "Untitled",
    slug: page.properties.Slug?.rich_text[0]?.plain_text || page.id,
    date: page.properties.PublishedDate?.date?.start || "",
    updated: page.properties.UpdatedDate?.date?.start || null,
    description: page.properties.Description?.rich_text[0]?.plain_text || "",
    cover: page.cover?.external?.url || page.cover?.file?.url || null
  }));

  await env.BLOG_CACHE.put(cacheKey, JSON.stringify(posts));
  return posts;
}

async function getNotionPostBySlug(slug, env, forceRefresh = false) {
  const allPosts = await getNotionPosts(env, forceRefresh);
  const postInfo = allPosts.find((p) => p.slug === slug);
  if (!postInfo) return null;

  const cacheKey = `notion_post_${postInfo.id}`;
  if (!forceRefresh) {
    const cached = await env.BLOG_CACHE.get(cacheKey, { type: "json" });
    if (cached) return cached;
  }

  const blocks = await getBlocksRecursive(postInfo.id, env);
  const htmlContent = convertBlocksToHtml(blocks);
  const fullPost = { ...postInfo, contentHtml: htmlContent };

  await env.BLOG_CACHE.put(cacheKey, JSON.stringify(fullPost));
  return fullPost;
}

async function getBlocksRecursive(blockId, env) {
  const results = await collectPaginatedAPI(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28"
      }
    }
  );

  await Promise.all(
    results.map(async (block) => {
      if (block.has_children) {
        block.children = await getBlocksRecursive(block.id, env);
      }
    })
  );

  return results;
}

async function collectPaginatedAPI(urlStr, options, bodyBase = null) {
  let results = [];
  let hasMore = true;
  let cursor = undefined;
  const isGet = options.method === "GET";

  while (hasMore) {
    let fetchUrl = urlStr;
    const fetchOptions = { ...options };

    if (isGet) {
      if (cursor) {
        const urlObj = new URL(urlStr);
        urlObj.searchParams.set("start_cursor", cursor);
        fetchUrl = urlObj.toString();
      }
    } else {
      const finalBody = bodyBase ? { ...bodyBase } : {};
      if (cursor) finalBody.start_cursor = cursor;
      if (Object.keys(finalBody).length > 0) {
        fetchOptions.body = JSON.stringify(finalBody);
      }
    }

    const response = await fetch(fetchUrl, fetchOptions);
    if (!response.ok) {
      console.error(`Notion API Error: ${response.status} on ${fetchUrl}`);
      return results;
    }

    const data = await response.json();
    results = results.concat(data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }
  return results;
}

/**
 * Block Parser to HTML
 */
function convertBlocksToHtml(blocks) {
  if (!blocks) return "";
  let html = "";
  let listTag = null;
  const closeList = () => {
    if (listTag) {
      html += `</${listTag}>`;
      listTag = null;
    }
  };

  blocks.forEach((block) => {
    // List Handling
    if (block.type === "bulleted_list_item") {
      if (listTag !== "ul") {
        closeList();
        html += "<ul>";
        listTag = "ul";
      }
    } else if (block.type === "numbered_list_item") {
      if (listTag !== "ol") {
        closeList();
        html += "<ol>";
        listTag = "ol";
      }
    } else {
      closeList();
    }

    switch (block.type) {
      case "paragraph":
        const p = parseRichText(block.paragraph.rich_text);
        html += p ? `<p>${p}</p>` : `<br>`;
        break;
      case "heading_1":
        html += `<h2>${parseRichText(block.heading_1.rich_text)}</h2>`;
        break;
      case "heading_2":
        html += `<h3>${parseRichText(block.heading_2.rich_text)}</h3>`;
        break;
      case "heading_3":
        html += `<h4>${parseRichText(block.heading_3.rich_text)}</h4>`;
        break;

      case "bulleted_list_item":
        html += `<li>${parseRichText(block.bulleted_list_item.rich_text)}${
          block.children ? convertBlocksToHtml(block.children) : ""
        }</li>`;
        break;
      case "numbered_list_item":
        html += `<li>${parseRichText(block.numbered_list_item.rich_text)}${
          block.children ? convertBlocksToHtml(block.children) : ""
        }</li>`;
        break;

      case "toggle":
        const summary = parseRichText(block.toggle.rich_text);
        const childrenHtml = block.children
          ? convertBlocksToHtml(block.children)
          : "";

        const uniqueId = "toggle-" + Math.random().toString(36).substr(2, 9);
        const contentId = `${uniqueId}-content`;
        const headerId = `${uniqueId}-header`;

        html += `
          <div class="accordion">
            <details class="accordion-trigger">
              <summary class="accordion-summary" aria-controls="${contentId}" id="${headerId}">
                <span class="accordion-term" role="term">${summary}</span>
              </summary>
            </details>

            <div class="accordion-content"
                  id="${contentId}"
                  role="region"
                  aria-labelledby="${headerId}">
              <div class="accordion-container">
                <div class="accordion-inner">
                  ${childrenHtml}
                </div>
              </div>
            </div>
          </div>`;
        break;

      case "quote":
        html += `<blockquote>${parseRichText(
          block.quote.rich_text
        )}</blockquote>`;
        break;
      case "divider":
        html += `<div class="w-rich-separator"></div>`;
        break;

      case "image":
        const src =
          block.image.type === "external"
            ? block.image.external.url
            : block.image.file.url;
        const cap = parseRichText(block.image.caption);
        html += `<figure class="w-richtext-align-fullwidth w-richtext-figure-type-image"><div><img src="${src}" alt="${cap}" loading="lazy"></div>${
          cap ? `<figcaption>${cap}</figcaption>` : ""
        }</figure>`;
        break;

      case "video":
        const vSrc =
          block.video.type === "external"
            ? block.video.external.url
            : block.video.file.url;
        html += `<div class="w-embed w-script"><video controls playsinline style="width: 100%; height: auto; border-radius: 8px;"><source src="${vSrc}" type="video/mp4"></video></div>`;
        break;

      case "code":
        const lang = block.code.language;
        const captionText = block.code.caption?.[0]?.plain_text || "";

        // Extract raw text to prevent internal HTML tags from breaking the <pre> block layout
        const rawCode = block.code.rich_text.map((t) => t.plain_text).join("");

        if (captionText.trim() === "Embed") {
          // Render as Raw HTML
          html += rawCode;
        } else {
          // Manually escape HTML entities for display
          const escapedCode = rawCode
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

          // String concatenation is used here to avoid source-code indentation
          // appearing in the final rendered HTML within the <pre> tag.
          html +=
            `<div class="code-wrapper" style="position: relative; margin-bottom: 20px;">` +
            `<button class="copy-btn" aria-label="Copy code">Copy</button>` +
            `<pre class="w-code-block" style="display:block; overflow-x:auto; background:#272822; color:#f8f8f2; padding:1em; border-radius: 0.3em; margin: 0;">` +
            `<code class="language-${lang}" style="white-space:pre;">${escapedCode}</code>` +
            `</pre>` +
            `</div>`;
        }
        break;
    }
  });
  closeList();
  return html;
}

function parseRichText(richTextArray) {
  if (!richTextArray) return "";
  return richTextArray
    .map((chunk) => {
      let text = chunk.plain_text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (chunk.annotations.bold) text = `<strong>${text}</strong>`;
      if (chunk.annotations.italic) text = `<em>${text}</em>`;
      if (chunk.annotations.code) text = `<code>${text}</code>`;
      if (chunk.annotations.underline)
        text = `<span style="text-decoration: underline;">${text}</span>`;
      if (chunk.annotations.strikethrough)
        text = `<span style="text-decoration: line-through;">${text}</span>`;
      if (chunk.href)
        text = `<a href="${chunk.href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      return text;
    })
    .join("");
}

/**
 * REWRITERS
 */
async function extractTemplateRobust(resClone) {
  let found = false;
  const rewriter = new HTMLRewriter().on('[data-template="item"]', {
    element(el) {
      found = true;
      el.before("|||TEMPLATE_START|||");
      el.after("|||TEMPLATE_END|||");
    }
  });
  const text = await rewriter.transform(resClone).text();
  if (!found) return null;
  return text.split("|||TEMPLATE_START|||")[1]?.split("|||TEMPLATE_END|||")[0];
}

async function populateTemplate(templateHtml, post) {
  const res = new Response(templateHtml);
  return await new HTMLRewriter()
    .on('[data-bind="title"]', new TextHandler(post.title))
    .on(
      '[data-bind="date"]',
      new TextHandler(
        new Date(post.date).toLocaleDateString(SITE_CONFIG.locale, {
          day: "numeric",
          month: "long",
          year: "numeric"
        })
      )
    )
    .on('[data-bind="description"]', new TextHandler(post.description))
    .on(
      '[data-bind="link"]',
      new LinkAttributeHandler(
        `${SITE_CONFIG.blogRoute}/${post.slug}`,
        post.title
      )
    )
    .on('[data-bind="image"]', new ImageHandler(post.cover, post.title))
    .on('[data-template="item"]', {
      element(el) {
        el.removeAttribute("data-template");
      }
    })
    .transform(res)
    .text();
}

/**
 * HTML Handler Classes
 */

class LinkHandler {
  element(e) {
    const h = e.getAttribute("href");
    if (h && !h.match(/^(http|#|mailto)/)) {
      // Clean .html extension and ensure root formatting
      let newHref = (h.endsWith(".html") ? h.slice(0, -5) : h).replace(
        /^([^/])/,
        "/$1"
      );
      if (newHref === "/index") newHref = "/";
      e.setAttribute("href", newHref);
    }
  }
}

class PrismHeadHandler {
  constructor(theme = "okaidia") {
    this.theme = theme;
  }
  element(e) {
    const cssUrl =
      this.theme === "prism"
        ? `https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css`
        : `https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-${this.theme}.min.css`;

    e.append(`<link href="${cssUrl}" rel="stylesheet" />`, { html: true });
  }
}

class PrismBodyHandler {
  element(e) {
    // 1. Prism Core & Autoloader
    e.append(
      `<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
       <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>`,
      { html: true }
    );

    // 2. Clipboard Logic
    const copyScript = `
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const wrapper = btn.closest('.code-wrapper');
              const codeEl = wrapper.querySelector('code');

              if (!codeEl) return;

              const textToCopy = codeEl.innerText;

              navigator.clipboard.writeText(textToCopy).then(() => {
                const originalText = btn.innerText;
                btn.innerText = 'Copied!';
                btn.classList.add('copied');

                setTimeout(() => {
                  btn.innerText = originalText;
                  btn.classList.remove('copied');
                }, 2000);
              }).catch(err => {
                console.error('Failed to copy:', err);
              });
            });
          });
        });
      </script>
    `;
    e.append(copyScript, { html: true });
  }
}

class AssetPathHandler {
  constructor(a) {
    this.a = a;
  }
  element(e) {
    const v = e.getAttribute(this.a);
    if (v && !v.match(/^(http|\/|data:)/)) e.setAttribute(this.a, "/" + v);
  }
}
class SrcSetHandler {
  element(e) {
    const s = e.getAttribute("srcset");
    if (s)
      e.setAttribute(
        "srcset",
        s
          .split(",")
          .map((p) => {
            const parts = p.trim().split(" ");
            if (!parts[0].match(/^(http|\/|data:)/)) parts[0] = "/" + parts[0];
            return parts.join(" ");
          })
          .join(", ")
      );
  }
}
class TextHandler {
  constructor(c, h = false) {
    this.c = c;
    this.h = h;
  }
  element(e) {
    if (this.c)
      this.h
        ? e.setInnerContent(this.c, { html: true })
        : e.setInnerContent(this.c);
  }
}
class AttributeHandler {
  constructor(a, v) {
    this.a = a;
    this.v = v;
  }
  element(e) {
    if (this.v) e.setAttribute(this.a, this.v);
  }
}
class LinkAttributeHandler {
  constructor(h, t) {
    this.h = h;
    this.t = t;
  }
  element(e) {
    if (this.h) e.setAttribute("href", this.h);
    if (this.t) e.setAttribute("title", this.t);
  }
}
class DateAttributeHandler {
  constructor(r, i) {
    this.r = r;
    this.i = i;
  }
  element(e) {
    if (this.r) e.setInnerContent(this.r);
    if (this.i) e.setAttribute("datetime", this.i);
  }
}
class ImageHandler {
  constructor(s, a) {
    this.s = s;
    this.a = a;
  }
  element(e) {
    if (this.s) {
      e.setAttribute("src", this.s);
      e.setAttribute("alt", this.a || "");
      e.removeAttribute("srcset");
    }
  }
}
class SchemaHandler {
  constructor(p, dp, du, u, d) {
    this.p = p;
    this.dp = dp;
    this.du = du;
    this.u = u;
    this.d = d;
  }
  element(e) {
    e.setInnerContent(
      JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: this.p.title,
          description: this.d,
          datePublished: this.dp,
          dateModified: this.du,
          mainEntityOfPage: { "@type": "WebPage", "@id": this.u },
          image: this.p.cover ? [this.p.cover] : [],
          author: [
            {
              "@type": "Person",
              name: SITE_CONFIG.author.name,
              url: SITE_CONFIG.author.url
            }
          ]
        },
        null,
        2
      ),
      { html: true }
    );
  }
}
class BlogListSchemaHandler {
  constructor(p, u) {
    this.p = p;
    this.u = u;
  }
  element(e) {
    e.setInnerContent(
      JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Blog",
          url: this.u,
          description: `Blog by ${SITE_CONFIG.author.name}`,
          mainEntity: {
            "@type": "Blog",
            blogPost: this.p.map((x) => ({
              "@type": "BlogPosting",
              headline: x.title,
              url: `${this.u}/${x.slug}`
            }))
          }
        },
        null,
        2
      ),
      { html: true }
    );
  }
}
