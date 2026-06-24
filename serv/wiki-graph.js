const fs = require("./FileSystem");
const path = require("path");
const { sanitizeTopic } = require("./sanitizer");
const { extractFirstImage } = require("./markdown");

const match_markdown_img = /\!\[([^\[\]]*)\]\(([^\)\n]+)\)/g;
const match_html_img = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const match_markdown_link = /\[(?=\S)([^\[\]\n]*(?<=\S))\]\(([^\)\n]*)\)/g;
const regex_match_fullversion_md = /^[^.]+\.md$/;

function splitTopicQueryHash(input = "") {
  let base = `${input || ""}`;
  let query = "";
  let hash = "";

  const hashIndex = base.indexOf("#");
  if (hashIndex !== -1) {
    hash = base.slice(hashIndex + 1);
    base = base.slice(0, hashIndex);
  }

  const queryIndex = base.indexOf("?");
  if (queryIndex !== -1) {
    query = base.slice(queryIndex + 1);
    base = base.slice(0, queryIndex);
  }

  return [base, query, hash];
}

function normalizeWikiEndpoint(wikiEndpoint = "wiki") {
  return `${wikiEndpoint}`.replace(/^\/+|\/+$/g, "");
}

function safeDecodeURIComponent(value = "") {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function normalizeTopicName(rawTopic = "") {
  const decoded = safeDecodeURIComponent(`${rawTopic || ""}`.trim());
  return sanitizeTopic(decoded).trim();
}

function stripInlineMarkdown(text = "") {
  return `${text || ""}`
    .replace(match_markdown_img, "$1")
    .replace(match_markdown_link, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/{{\s*[a-z]+:[^}]+\s*}}/gi, "")
    .trim();
}

function extractPageTitle(markdown = "", fallbackTopic = "") {
  const match = `${markdown || ""}`.match(/^#\s+(.+?)(?:\s+#+\s*)?$/m);
  if (!match) return fallbackTopic;
  const title = stripInlineMarkdown(match[1]);
  return title || fallbackTopic;
}

function normalizeImageHref(rawUrl = "", wikiEndpoint = "wiki") {
  const [base] = splitTopicQueryHash(rawUrl);
  if (!base || /^data:/i.test(base) || /^https?:/i.test(base)) return "";
  if (base.startsWith("/")) return base;
  return `/${normalizeWikiEndpoint(wikiEndpoint)}/view/${base.replace(/^\/+/, "")}`;
}

function isImagePathCandidate(rawUrl = "") {
  if (!rawUrl || /^data:/i.test(rawUrl) || /^https?:/i.test(rawUrl)) return false;
  return true;
}

function parseAbsoluteWikiViewTarget(rawUrl = "", wikiEndpoint = "wiki") {
  const [base] = splitTopicQueryHash(rawUrl);
  if (!base || !base.startsWith("/")) return "";

  const normalizedEndpoint = normalizeWikiEndpoint(wikiEndpoint);
  const rootPath = `/${normalizedEndpoint}/view`;
  const prefix = `/${normalizedEndpoint}/view/`;
  if (base === rootPath || base === `${rootPath}/`) return "index";
  if (!base.startsWith(prefix)) return "";

  const remainder = base.slice(prefix.length);
  const topicSegment = remainder.split("/").filter(Boolean)[0] || "";
  return normalizeTopicName(topicSegment);
}

function classifyGraphLink(rawUrl = "", wikiEndpoint = "wiki") {
  const url = `${rawUrl || ""}`.trim();
  if (!url) return { kind: "ignore" };
  if (/^https?:/i.test(url)) return { kind: "external", url };
  if (url.startsWith("#")) return { kind: "ignore" };
  if (url.startsWith("?")) return { kind: "ignore" };

  if (url.startsWith("/")) {
    const topic = parseAbsoluteWikiViewTarget(url, wikiEndpoint);
    return topic ? { kind: "topic", topic, rawUrl: url } : { kind: "ignore" };
  }

  const [base] = splitTopicQueryHash(url);
  const topic = normalizeTopicName(base);
  return topic ? { kind: "topic", topic, rawUrl: url } : { kind: "ignore" };
}

function findImageMatchRanges(markdown = "") {
  const ranges = [];
  const regex = new RegExp(match_markdown_img);
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function overlapsImageRange(index = 0, ranges = []) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function extractWikiGraphRefs(markdown = "", options = {}) {
  const {
    wikiEndpoint = "wiki",
    includeImages = true,
  } = options;

  const refs = [];
  const seenImageIds = new Set();
  const imageRanges = findImageMatchRanges(markdown);

  function pushImageRef(rawUrl = "", label = "") {
    const href = normalizeImageHref(rawUrl, wikiEndpoint);
    if (!href || !isImagePathCandidate(rawUrl)) return;
    const id = `image:${href}`;
    if (seenImageIds.has(id)) return;
    seenImageIds.add(id);
    const labelBase = path.basename(splitTopicQueryHash(rawUrl)[0] || href) || "image";
    refs.push({
      kind: "image",
      id,
      label: label.trim() || labelBase,
      href,
      rawUrl,
    });
  }

  if (includeImages) {
    const imageRegex = new RegExp(match_markdown_img);
    let imageMatch;
    while ((imageMatch = imageRegex.exec(markdown)) !== null) {
      const [, alt = "", rawUrl = ""] = imageMatch;
      pushImageRef(rawUrl, alt);
    }

    const htmlImageRegex = new RegExp(match_html_img);
    let htmlImageMatch;
    while ((htmlImageMatch = htmlImageRegex.exec(markdown)) !== null) {
      const [tag = "", rawUrl = ""] = htmlImageMatch;
      const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
      pushImageRef(rawUrl, altMatch ? altMatch[1] : "");
    }
  }

  const linkRegex = new RegExp(match_markdown_link);
  let linkMatch;
  while ((linkMatch = linkRegex.exec(markdown)) !== null) {
    if (overlapsImageRange(linkMatch.index, imageRanges)) continue;
    const [, title = "", rawUrl = ""] = linkMatch;
    const classified = classifyGraphLink(rawUrl, wikiEndpoint);
    if (classified.kind === "topic") {
      refs.push({
        kind: "topic",
        topic: classified.topic,
        label: title.trim() || classified.topic,
        rawUrl,
      });
    } else if (classified.kind === "external") {
      refs.push({
        kind: "external",
        label: title.trim() || classified.url,
        href: classified.url,
        rawUrl,
      });
    }
  }

  return refs;
}

function readWikiGraphIndex(options = {}) {
  const {
    wikiDir,
    wikiEndpoint = "wiki",
    includeImages = true,
    changelogTopicName = "ChangeLog",
  } = options;

  const files = fs.readdirSync(wikiDir).filter(file => regex_match_fullversion_md.test(file));
  const pages = new Map();

  files.forEach(file => {
    const topic = path.basename(file, ".md");
    if (topic === changelogTopicName) return;
    const filePath = path.join(wikiDir, file);
    const markdown = fs.readFileSync(filePath, "utf8");
    const refs = extractWikiGraphRefs(markdown, { wikiEndpoint, includeImages });
    const title = extractPageTitle(markdown, topic);
    const heroImageRawUrl = extractFirstImage(markdown, 10);
    const heroImageUrl = heroImageRawUrl
      ? normalizeImageHref(heroImageRawUrl, wikiEndpoint)
      : "";
    const heroImageRef = heroImageUrl
      ? refs.find(ref => ref.kind === "image" && ref.href === heroImageUrl)
      : null;
    pages.set(topic, {
      topic,
      title,
      file,
      filePath,
      markdown,
      refs,
      heroImageUrl: heroImageRef ? heroImageRef.href : "",
      heroImageLabel: heroImageRef ? heroImageRef.label : "",
    });
  });

  return pages;
}

function coerceHopLimit(rawHops) {
  if (rawHops === undefined || rawHops === null || rawHops === "") {
    return { hopLimit: Number.POSITIVE_INFINITY, isFull: true, label: "Full" };
  }

  if (`${rawHops}`.toLowerCase() === "full") {
    return { hopLimit: Number.POSITIVE_INFINITY, isFull: true, label: "Full" };
  }

  const parsed = parseInt(rawHops, 10);
  if (!Number.isFinite(parsed)) {
    return { hopLimit: Number.POSITIVE_INFINITY, isFull: true, label: "Full" };
  }

  const clamped = Math.max(1, parsed);
  return { hopLimit: clamped, isFull: false, label: `${clamped}` };
}

function buildSubgraphFromIndex(index, options = {}) {
  const {
    rootTopic = "",
    rawHops,
    wikiEndpoint = "wiki",
    includeImages = true,
    includeAllPages = false,
  } = options;

  const hopInfo = coerceHopLimit(rawHops);
  const nodes = new Map();
  const edges = new Map();
  const queue = [];
  const visitDepths = new Map();
  const existingTopics = new Set(index.keys());
  const normalizedRootTopic = rootTopic ? normalizeTopicName(rootTopic) : "";
  const wikiRoot = `/${normalizeWikiEndpoint(wikiEndpoint)}`;

  function upsertNode(id, partial) {
    const existing = nodes.get(id) || { id, incoming: 0, outgoing: 0 };
    const merged = { ...existing, ...partial };
    if (existing.depth !== undefined && partial.depth !== undefined) {
      merged.depth = Math.min(existing.depth, partial.depth);
    }
    nodes.set(id, merged);
    return merged;
  }

  function registerEdge(sourceId, targetId, type) {
    const key = `${sourceId}=>${targetId}|${type}`;
    const edge = edges.get(key) || { source: sourceId, target: targetId, type, weight: 0 };
    edge.weight += 1;
    edges.set(key, edge);
  }

  function enqueueTopic(topic, depth) {
    if (!existingTopics.has(topic)) return;
    const previousDepth = visitDepths.get(topic);
    if (previousDepth !== undefined && previousDepth <= depth) return;
    visitDepths.set(topic, depth);
    queue.push({ topic, depth });
  }

  function computeMaxReachableDepth() {
    if (includeAllPages) return 0;
    if (!normalizedRootTopic || !index.has(normalizedRootTopic)) return 0;

    const seenDepths = new Map([[normalizedRootTopic, 0]]);
    const bfsQueue = [{ topic: normalizedRootTopic, depth: 0 }];
    let maxDepth = 0;

    while (bfsQueue.length > 0) {
      const { topic, depth } = bfsQueue.shift();
      const page = index.get(topic);
      if (!page) continue;
      maxDepth = Math.max(maxDepth, depth);

      page.refs.forEach(ref => {
        if (ref.kind !== "topic") return;
        if (!existingTopics.has(ref.topic)) {
          maxDepth = Math.max(maxDepth, depth + 1);
          return;
        }
        const previousDepth = seenDepths.get(ref.topic);
        if (previousDepth !== undefined && previousDepth <= depth + 1) return;
        seenDepths.set(ref.topic, depth + 1);
        bfsQueue.push({ topic: ref.topic, depth: depth + 1 });
      });
    }

    return Math.max(1, maxDepth);
  }

  const maxDetectedHop = computeMaxReachableDepth();
  if (!hopInfo.isFull) {
    hopInfo.hopLimit = Math.min(hopInfo.hopLimit, maxDetectedHop);
    hopInfo.label = `${hopInfo.hopLimit}`;
  }

    if (includeAllPages) {
    index.forEach((page, topic) => {
      upsertNode(topic, {
        id: topic,
        label: page.title || topic,
        topic,
        type: "page",
        href: `${wikiRoot}/view/${encodeURIComponent(topic)}`,
        exists: true,
        depth: 0,
        heroImageUrl: page.heroImageUrl || "",
        heroImageLabel: page.heroImageLabel || "",
      });
      enqueueTopic(topic, 0);
    });
  } else {
    if (!normalizedRootTopic || !index.has(normalizedRootTopic)) {
      return {
        error: normalizedRootTopic ? `Topic "${normalizedRootTopic}" not found.` : "Topic not found.",
        status: 404,
      };
    }
    upsertNode(normalizedRootTopic, {
      id: normalizedRootTopic,
      label: index.get(normalizedRootTopic)?.title || normalizedRootTopic,
      topic: normalizedRootTopic,
      type: "page",
      href: `${wikiRoot}/view/${encodeURIComponent(normalizedRootTopic)}`,
      exists: true,
      depth: 0,
      isRoot: true,
      heroImageUrl: index.get(normalizedRootTopic)?.heroImageUrl || "",
      heroImageLabel: index.get(normalizedRootTopic)?.heroImageLabel || "",
    });
    enqueueTopic(normalizedRootTopic, 0);
  }

  while (queue.length > 0) {
    const { topic, depth } = queue.shift();
    const page = index.get(topic);
    if (!page) continue;

    upsertNode(topic, {
      id: topic,
      label: page.title || topic,
      topic,
      type: "page",
      href: `${wikiRoot}/view/${encodeURIComponent(topic)}`,
      exists: true,
      depth,
      isRoot: !includeAllPages && topic === normalizedRootTopic,
      heroImageUrl: page.heroImageUrl || "",
      heroImageLabel: page.heroImageLabel || "",
    });

    if (!hopInfo.isFull && depth >= hopInfo.hopLimit) continue;

    page.refs.forEach(ref => {
      if (ref.kind === "topic") {
        const exists = existingTopics.has(ref.topic);
        const ghostSearchHref = !exists
          ? `${wikiRoot}/view/${encodeURIComponent(topic)}?searchterm=${encodeURIComponent(`](${ref.topic})`)}`
          : undefined;
        const nextNode = {
          id: ref.topic,
          label: exists ? (index.get(ref.topic)?.title || ref.topic) : ref.topic,
          topic: ref.topic,
          type: exists ? "page" : "ghost",
          href: `${wikiRoot}/view/${encodeURIComponent(ref.topic)}`,
          exists,
          depth: depth + 1,
          heroImageUrl: exists ? (index.get(ref.topic)?.heroImageUrl || "") : "",
          heroImageLabel: exists ? (index.get(ref.topic)?.heroImageLabel || "") : "",
        };
        if (!exists) {
          const existingGhost = nodes.get(ref.topic);
          if (!existingGhost || !existingGhost.parentSearchHref) {
            nextNode.parentSearchHref = ghostSearchHref;
            nextNode.parentTopic = topic;
          }
        }
        upsertNode(ref.topic, nextNode);
        registerEdge(topic, ref.topic, "wiki");
        if (exists) enqueueTopic(ref.topic, depth + 1);
      }

      if (includeImages && ref.kind === "image") {
        upsertNode(ref.id, {
          id: ref.id,
          label: ref.label,
          type: "image",
          href: ref.href,
          exists: true,
          depth: depth + 1,
          imageUrl: ref.href,
        });
        registerEdge(topic, ref.id, "image");
      }
    });
  }

  Array.from(edges.values()).forEach(edge => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.outgoing += edge.weight;
    if (target) target.incoming += edge.weight;
  });

  const nodeList = Array.from(nodes.values())
    .sort((a, b) => {
      if ((a.isRoot ? 1 : 0) !== (b.isRoot ? 1 : 0)) return (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0);
      if ((a.type === "page" ? 1 : 0) !== (b.type === "page" ? 1 : 0)) return (b.type === "page" ? 1 : 0) - (a.type === "page" ? 1 : 0);
      return a.label.localeCompare(b.label);
    })
    .map(node => ({
      ...node,
      degree: (node.incoming || 0) + (node.outgoing || 0),
    }));
  const graphPageCount = nodeList.filter(node => node.type === "page").length;

  return {
    meta: {
      rootTopic: includeAllPages ? "" : normalizedRootTopic,
      includeAllPages,
      hopLimit: hopInfo.isFull ? null : hopInfo.hopLimit,
      hopLabel: hopInfo.label,
      isFull: hopInfo.isFull,
      wikiEndpoint: `/${normalizeWikiEndpoint(wikiEndpoint)}`,
      pageCount: graphPageCount,
      graphNodeCount: nodeList.length,
      graphEdgeCount: edges.size,
      maxDetectedHop,
    },
    nodes: nodeList,
    links: Array.from(edges.values()),
  };
}

function runTests() {
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const refs = extractWikiGraphRefs(`
[One](SomeTopic)
[Two](/wiki/view/Other%20Topic?searchterm=bok#Heading)
[Home](/wiki/view)
[Anchor](#heading)
[External](https://example.com)
![photo](/wiki/uploads/123.png)
![offsite](https://example.com/x.png)
`, { wikiEndpoint: "wiki", includeImages: true });

  assert(refs.filter(ref => ref.kind === "topic").length === 3, "Expected three topic refs");
  assert(refs.some(ref => ref.kind === "topic" && ref.topic === "SomeTopic"), "Expected SomeTopic ref");
  assert(refs.some(ref => ref.kind === "topic" && ref.topic === "Other Topic"), "Expected absolute wiki view ref");
  assert(refs.some(ref => ref.kind === "topic" && ref.topic === "index"), "Expected /wiki/view to map to index");
  assert(!refs.some(ref => ref.kind === "topic" && ref.topic === "heading"), "Hash-only links should be ignored");
  assert(refs.some(ref => ref.kind === "image" && ref.href === "/wiki/uploads/123.png"), "Expected local image ref");
  assert(!refs.some(ref => ref.kind === "image" && /example/.test(ref.href || "")), "External images should be ignored");

  const fakeIndex = new Map([
    ["Root", { topic: "Root", title: "Root Title", refs: [{ kind: "topic", topic: "Child" }, { kind: "topic", topic: "Ghost" }] }],
    ["Child", { topic: "Child", title: "Child Title", refs: [{ kind: "topic", topic: "Leaf" }] }],
    ["Leaf", { topic: "Leaf", title: "Leaf Title", refs: [] }],
  ]);

  const hop1 = buildSubgraphFromIndex(fakeIndex, { rootTopic: "Root", rawHops: 1, wikiEndpoint: "wiki" });
  assert(hop1.nodes.some(node => node.id === "Root"), "Root should exist");
  assert(hop1.nodes.some(node => node.id === "Root" && node.label === "Root Title"), "Root title should come from page title");
  assert(hop1.nodes.some(node => node.id === "Child"), "Child should exist at 1 hop");
  assert(hop1.nodes.some(node => node.id === "Ghost" && node.type === "ghost"), "Dangling topic should be ghost");
  assert(!hop1.nodes.some(node => node.id === "Leaf"), "Leaf should not exist at 1 hop");

  const full = buildSubgraphFromIndex(fakeIndex, { rootTopic: "Root", rawHops: "full", wikiEndpoint: "wiki" });
  assert(full.nodes.some(node => node.id === "Leaf"), "Leaf should exist in full graph");

  const title = extractPageTitle(`# Hello *World*\n\nBody`, "Fallback");
  assert(title === "Hello World", "Expected first single # heading title");
}

runTests();

module.exports.extractWikiGraphRefs = extractWikiGraphRefs;
module.exports.readWikiGraphIndex = readWikiGraphIndex;
module.exports.buildSubgraphFromIndex = buildSubgraphFromIndex;
module.exports.coerceHopLimit = coerceHopLimit;
