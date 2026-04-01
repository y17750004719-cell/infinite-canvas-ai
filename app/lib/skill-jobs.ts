import fs from "fs";
import path from "path";
import { runImageTask } from "./api-client";
import { resolvePublicAssetDataUrl } from "./api-security.mjs";
import { createLogger, serializeError } from "./logger";

const LOG_LEVEL = (process.env.LOG_LEVEL || "basic").toLowerCase();
const LOG_ENABLED = LOG_LEVEL !== "off";
const LOG_DEBUG = LOG_LEVEL === "debug";
const skillJobsLogger = createLogger("lib.skill-jobs");

function toLogDetails(payload?: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function logBasic(message: string, payload?: unknown) {
  if (LOG_ENABLED) {
    void skillJobsLogger.info("info", message, toLogDetails(payload));
  }
}

function logDebug(message: string, payload?: unknown) {
  if (LOG_DEBUG) {
    void skillJobsLogger.info("debug", message, toLogDetails(payload));
  }
}

export type JobItemStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "partial" | "cancelled";

export interface SkillJobItem {
  key: string;
  name: string;
  prompt?: string;
  size: string;
  referenceImages?: string[];
  status: JobItemStatus;
  localUrl?: string;
  error?: string;
}

export interface SkillJob {
  id: string;
  skillType: string;
  status: JobStatus;
  metadata: Record<string, unknown>;
  items: SkillJobItem[];
  cancelRequested?: boolean;
  createdAt: number;
  updatedAt: number;
}

const IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_CONCURRENCY = 3;
const ALLOWED_ASPECT_RATIOS = new Set([
  "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
]);

type SkillJobStore = {
  jobs: Map<string, SkillJob>;
  controllers: Map<string, Set<AbortController>>;
};

const globalSkillJobs = globalThis as unknown as {
  __skillJobStore?: SkillJobStore;
};

if (!globalSkillJobs.__skillJobStore) {
  globalSkillJobs.__skillJobStore = {
    jobs: new Map<string, SkillJob>(),
    controllers: new Map<string, Set<AbortController>>(),
  };
}

const skillJobs = globalSkillJobs.__skillJobStore.jobs;
const skillJobControllers = globalSkillJobs.__skillJobStore.controllers;

const DEFAULT_LOGO_COMPONENTS = [
  { key: "logo", name: "品牌 Logo", size: "2048x2048" },
  { key: "business_card", name: "名片", size: "1024x1024" },
  { key: "letterhead", name: "信纸", size: "1024x768" },
  { key: "envelope", name: "信封", size: "1024x768" },
  { key: "poster", name: "海报", size: "768x1024" },
  { key: "packaging_cup", name: "杯套", size: "1024x1024" },
  { key: "packaging_bag", name: "纸袋", size: "1024x768" },
] as const;

const DEFAULT_BRAND_MATERIAL_POOL = [
  { key: "tshirt", name: "品牌 T 恤" },
  { key: "hoodie", name: "品牌卫衣" },
  { key: "cap", name: "棒球帽" },
  { key: "socks", name: "品牌袜子" },
  { key: "tote_bag", name: "帆布袋" },
  { key: "notebook", name: "品牌笔记本" },
  { key: "phone_case", name: "手机壳" },
  { key: "mug", name: "马克杯" },
  { key: "sticker_pack", name: "贴纸套装" },
  { key: "lanyard", name: "挂绳" },
  { key: "keychain", name: "钥匙扣" },
  { key: "mouse_pad", name: "鼠标垫" },
  { key: "water_bottle", name: "水壶" },
  { key: "signage", name: "导视系统牌" },
  { key: "shopping_bag", name: "购物袋" },
  { key: "packaging_box", name: "包装盒" },
] as const;

interface LogoSkillComponentConfig {
  key: string;
  name: string;
  size: string;
}

interface LogoSkillConfig {
  job?: { concurrency?: number };
  components?: LogoSkillComponentConfig[];
}

interface BrandSkillConfig {
  nine_grid?: {
    size?: string;
    default_material_types?: string[];
  };
}

interface BrandJobMetadata {
  brandName: string;
  industry: string;
  mode: "nine_grid" | "single_or_specific";
  selectedMaterials: string[];
  specificMaterials: string[];
  brandBrief: string;
  viGuide: string;
  userRequirement: string;
  logoReferenceHint: string;
  concurrency: number;
}

function getReferenceType(input: string): "data" | "http" | "local" | "unknown" {
  if (input.startsWith("data:image/")) return "data";
  if (input.startsWith("http://") || input.startsWith("https://")) return "http";
  if (input.startsWith("/")) return "local";
  return "unknown";
}

async function normalizeReferenceImages(inputs?: string[]): Promise<string[]> {
  if (!inputs || inputs.length === 0) return [];

  const normalized: string[] = [];

  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;

    if (input.startsWith("data:image/")) {
      normalized.push(input);
      continue;
    }

    if (input.startsWith("http://") || input.startsWith("https://")) {
      normalized.push(input);
      continue;
    }

    const dataUrl = resolvePublicAssetDataUrl(input, {
      publicDir: path.join(process.cwd(), "public"),
      allowedExtensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    });
    if (dataUrl) {
      normalized.push(dataUrl);
    }
  }

  return normalized;
}

const INDUSTRY_STYLES: Record<string, { keywords: string[]; colors: string[] }> = {
  "咖啡": { keywords: ["warm", "cozy", "premium", "artisanal", "natural"], colors: ["earth tones", "warm brown", "cream", "forest green"] },
  "餐饮": { keywords: ["appetizing", "vibrant", "welcoming", "authentic"], colors: ["warm orange", "red", "golden", "fresh green"] },
  "时尚": { keywords: ["elegant", "minimalist", "chic", "sophisticated"], colors: ["black", "white", "gold", "muted tones"] },
  "科技": { keywords: ["modern", "futuristic", "clean", "innovative"], colors: ["blue", "cyan", "white", "dark gray"] },
  "健康": { keywords: ["fresh", "natural", "peaceful", "clean"], colors: ["green", "white", "light blue", "natural tones"] },
  "教育": { keywords: ["friendly", "professional", "trustworthy", "creative"], colors: ["blue", "yellow", "orange", "green"] },
};

const LOGO_PROMPT_TEMPLATES: Record<string, string> = {
  logo: "Professional {industry} brand logo design, {style_keywords}, minimalist vector style, clean lines, memorable icon, white or transparent background, high contrast, suitable for digital and print, {brand_name} brand identity",
  business_card: "Mockup of professional business card design for {brand_name} {industry} brand, {style_keywords}, {color_scheme} color palette, elegant typography, clean layout, photorealistic render, lying on wooden table, natural lighting",
  letterhead: "Professional letterhead design for {brand_name}, {industry} brand, {style_keywords}, {color_scheme} color scheme, elegant header with logo, clean typography, A4 paper size, minimalist corporate stationery design, photorealistic",
  envelope: "Premium envelope design for {brand_name} {industry} brand, {style_keywords}, {color_scheme} color, elegant logo placement on flap, clean minimalist corporate envelope, photorealistic render",
  poster: "Modern promotional poster design for {brand_name} {industry}, {style_keywords}, {color_scheme} color palette, bold headline area, minimalist layout, professional photography integration, print-ready, A3 size",
  packaging_cup: "Custom coffee cup sleeve packaging design for {brand_name}, {style_keywords}, {color_scheme} color scheme, minimalist brand logo placement, clean die-line mockup, photorealistic render, white coffee cup",
  packaging_bag: "Paper bag packaging design for {brand_name} {industry} brand, {style_keywords}, {color_scheme} colors, elegant logo on both sides, kraft paper texture, handles, retail packaging mockup, photorealistic",
};

function generateLogoPrompt(componentKey: string, brandName: string, industry: string): string {
  const style = INDUSTRY_STYLES[industry] || INDUSTRY_STYLES["咖啡"];
  const template = LOGO_PROMPT_TEMPLATES[componentKey] || LOGO_PROMPT_TEMPLATES.logo;
  return template
    .replace(/{brand_name}/g, brandName)
    .replace(/{industry}/g, industry)
    .replace(/{style_keywords}/g, style.keywords.join(", "))
    .replace(/{color_scheme}/g, style.colors.join(", "));
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function isSupportedSize(size: string): boolean {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return ALLOWED_ASPECT_RATIOS.has(ratio);
}

function loadLogoSkillConfig(): { components: LogoSkillComponentConfig[]; concurrency: number } {
  const fallback = {
    components: [...DEFAULT_LOGO_COMPONENTS],
    concurrency: DEFAULT_CONCURRENCY,
  };

  const configPath = path.join(process.cwd(), "skills", "logo", "config.json");
  if (!fs.existsSync(configPath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as LogoSkillConfig;

    const concurrency =
      typeof parsed.job?.concurrency === "number" && parsed.job.concurrency > 0
        ? Math.floor(parsed.job.concurrency)
        : DEFAULT_CONCURRENCY;

    const components = Array.isArray(parsed.components)
      ? parsed.components
          .filter((item): item is LogoSkillComponentConfig =>
            !!item &&
            typeof item.key === "string" &&
            typeof item.name === "string" &&
            typeof item.size === "string" &&
            item.key.trim().length > 0 &&
            item.name.trim().length > 0 &&
            isSupportedSize(item.size)
          )
          .map((item) => ({ key: item.key.trim(), name: item.name.trim(), size: item.size.trim() }))
      : [];

    if (components.length === 0) {
      void skillJobsLogger.warn("config.logo.invalid", "logo config.json has no valid components, fallback to defaults", {
        configPath,
      });
      return { components: fallback.components, concurrency };
    }

    return { components, concurrency };
  } catch (error) {
    void skillJobsLogger.error("config.logo.parse_error", "Failed to parse logo config.json, fallback to defaults", {
      configPath,
      error: serializeError(error),
    });
    return fallback;
  }
}

function shuffleArray<T>(items: T[]): T[] {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = cloned[i];
    cloned[i] = cloned[j];
    cloned[j] = temp;
  }
  return cloned;
}

function loadBrandSkillConfig(): { nineGridSize: string; materialTypes: string[] } {
  const fallback = {
    nineGridSize: "2048x2048",
    materialTypes: [...DEFAULT_BRAND_MATERIAL_POOL.map((item) => item.key)],
  };

  const configPath = path.join(process.cwd(), "skills", "brand", "config.json");
  if (!fs.existsSync(configPath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as BrandSkillConfig;

    const nineGridSize =
      typeof parsed.nine_grid?.size === "string" && isSupportedSize(parsed.nine_grid.size)
        ? parsed.nine_grid.size
        : fallback.nineGridSize;

    const materialTypes = Array.isArray(parsed.nine_grid?.default_material_types)
      ? parsed.nine_grid.default_material_types.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : fallback.materialTypes;

    return {
      nineGridSize,
      materialTypes: materialTypes.length > 0 ? materialTypes : fallback.materialTypes,
    };
  } catch (error) {
    void skillJobsLogger.error("config.brand.parse_error", "Failed to parse brand config.json, fallback to defaults", {
      configPath,
      error: serializeError(error),
    });
    return fallback;
  }
}

function humanizeMaterialKey(key: string): string {
  const map: Record<string, string> = Object.fromEntries(
    DEFAULT_BRAND_MATERIAL_POOL.map((item) => [item.key, item.name])
  );
  return map[key] || key.replace(/_/g, " ");
}

function describeMaterialForPrompt(key: string): string {
  const descriptors: Record<string, string> = {
    tshirt: "heavyweight cotton T-shirt with clean chest logo application",
    hoodie: "brushed fleece hoodie with tonal logo treatment",
    cap: "structured baseball cap in twill fabric with embroidered logo",
    socks: "ribbed crew socks in cotton blend with subtle logo detail",
    tote_bag: "canvas tote bag with reinforced stitching and front logo print",
    notebook: "linen-cover notebook with debossed logo mark",
    phone_case: "matte polycarbonate phone case with centered logo lockup",
    mug: "ceramic mug with satin glaze and minimal logo placement",
    sticker_pack: "die-cut vinyl sticker pack with brand graphic system",
    lanyard: "woven polyester lanyard with repeating logo pattern",
    keychain: "anodized metal keychain with engraved logo",
    mouse_pad: "micro-texture desk mouse pad with corner logo accent",
    water_bottle: "powder-coated stainless steel water bottle with vertical logo",
    signage: "architectural wayfinding signage in brushed metal finish",
    shopping_bag: "premium shopping bag in textured paper with rope handles",
    packaging_box: "rigid packaging box with soft-touch coating and foil logo",
  };

  if (descriptors[key]) return descriptors[key];
  return `${key.replace(/_/g, " ")} with premium material finish and brand logo integration`;
}

function buildNineGridPrompt(
  brandName: string,
  industry: string,
  materials: string[],
  brandBrief: string,
  viGuide: string,
  userRequirement: string,
  logoReferenceHint: string
): string {
  const materialDescriptors = materials.map((key) => describeMaterialForPrompt(key));
  const viSnippet = viGuide.slice(0, 1200);
  const briefSnippet = brandBrief.slice(0, 1200);
  const requirementSnippet = userRequirement.slice(0, 500);

  return [
    "基于这个logo，",
    `Create a single 3x3 brand material moodboard for ${brandName} (${industry}) in one image.`,
    "Each cell must be square (1:1), with consistent spacing and composition. Final board is 2048x2048.",
    `Depict these nine product applications as unlabeled physical objects: ${materialDescriptors.join(", ")}.`,
    "All materials must share one coherent visual identity and be clearly distinguishable per cell.",
    `Brand strategy reference: ${briefSnippet || "N/A"}`,
    `VI guide reference: ${viSnippet || "N/A"}`,
    `Extra requirement: ${requirementSnippet || "none"}`,
    `Logo reference rule: ${logoReferenceHint}`,
    "Critical visual constraint: do not render any labels, captions, callouts, titles, numbering, or material names in any language anywhere in the image.",
    "Only the brand logo artwork from the reference may appear as part of product branding.",
    "Photorealistic studio lighting, premium product presentation, no text overlays, no watermark.",
  ].join(" ");
}

function buildSingleMaterialPrompt(
  brandName: string,
  industry: string,
  materialKey: string,
  brandBrief: string,
  viGuide: string,
  userRequirement: string,
  logoReferenceHint: string
): string {
  const viSnippet = viGuide.slice(0, 1200);
  const briefSnippet = brandBrief.slice(0, 1200);
  const requirementSnippet = userRequirement.slice(0, 500);
  const materialDescriptor = describeMaterialForPrompt(materialKey);

  return [
    "基于这个logo，",
    `Create a premium ${materialDescriptor} design for ${brandName} (${industry}).`,
    "Single hero product shot, square composition (1:1), high detail, commercial quality.",
    `Brand strategy reference: ${briefSnippet || "N/A"}`,
    `VI guide reference: ${viSnippet || "N/A"}`,
    `User requirement: ${requirementSnippet || "none"}`,
    `Logo reference rule: ${logoReferenceHint}`,
    "Critical visual constraint: do not render any labels, captions, callouts, titles, or material names in any language.",
    "Only the brand logo artwork from the reference may appear as part of product branding.",
    "Minimalist background, physically plausible materials, no watermark.",
  ].join(" ");
}

async function saveImageToLocal(imageUrl: string, key: string): Promise<{ filename: string; localUrl: string }> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `${key}-${timestamp}-${random}.png`;
  const outputDir = path.join(process.cwd(), "public", "uploads", "generated");
  const filepath = path.join(outputDir, filename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const response = await fetch(imageUrl, { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filepath, Buffer.from(buffer));

  return { filename, localUrl: `/uploads/generated/${filename}` };
}

function nowId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function buildLogoJob(payload: Record<string, unknown>): SkillJob {
  const brandName = typeof payload.brandName === "string" && payload.brandName.trim() ? payload.brandName.trim() : "MyBrand";
  const industry = typeof payload.industry === "string" && payload.industry.trim() ? payload.industry.trim() : "咖啡";
  const style = INDUSTRY_STYLES[industry] || INDUSTRY_STYLES["咖啡"];
  const logoConfig = loadLogoSkillConfig();
  const id = nowId();
  const createdAt = Date.now();

  const items: SkillJobItem[] = logoConfig.components.map((component) => ({
    key: component.key,
    name: component.name,
    size: component.size,
    status: "queued",
  }));

  return {
    id,
    skillType: "logo",
    status: "queued",
    metadata: {
      brandName,
      industry,
      styleKeywords: style.keywords.join(", "),
      colorScheme: style.colors.join(", "),
      concurrency: logoConfig.concurrency,
    },
    items,
    createdAt,
    updatedAt: createdAt,
  };
}

function buildBrandJob(payload: Record<string, unknown>): SkillJob {
  const brandName = typeof payload.brandName === "string" && payload.brandName.trim() ? payload.brandName.trim() : "MyBrand";
  const industry = typeof payload.industry === "string" && payload.industry.trim() ? payload.industry.trim() : "消费品";
  const brandBrief = typeof payload.brandBrief === "string" ? payload.brandBrief : "";
  const viGuide = typeof payload.viGuide === "string" ? payload.viGuide : "";
  const userRequirement = typeof payload.userRequirement === "string" ? payload.userRequirement : "";
  const logoReferenceHint = typeof payload.logoReferenceHint === "string" && payload.logoReferenceHint.trim()
    ? payload.logoReferenceHint.trim()
    : "Use provided logo as strict visual identity reference.";

  const requestedMaterials = Array.isArray(payload.materialRequests)
    ? payload.materialRequests.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const logoReferenceImages = Array.isArray(payload.logoReferenceImages)
    ? payload.logoReferenceImages.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  const brandConfig = loadBrandSkillConfig();
  const id = nowId();
  const createdAt = Date.now();

  const mode = requestedMaterials.length > 0 ? "single_or_specific" : "nine_grid";
  const materialsForGrid = shuffleArray(brandConfig.materialTypes).slice(0, 9);

  const items: SkillJobItem[] = mode === "nine_grid"
    ? [{
        key: "brand_9grid",
        name: "品牌九宫格物料",
        size: brandConfig.nineGridSize,
        referenceImages: logoReferenceImages,
        status: "queued",
      }]
    : requestedMaterials.slice(0, 6).map((materialKey, index) => ({
        key: `brand_material_${index + 1}`,
        name: humanizeMaterialKey(materialKey),
        size: "2048x2048",
        referenceImages: logoReferenceImages,
        status: "queued",
      }));

  const metadata: Record<string, unknown> = {
    brandName,
    industry,
    mode,
    selectedMaterials: mode === "nine_grid" ? materialsForGrid : requestedMaterials,
    specificMaterials: requestedMaterials,
    brandBrief,
    viGuide,
    userRequirement,
    logoReferenceHint,
    concurrency: 1,
  };

  return {
    id,
    skillType: "brand",
    status: "queued",
    metadata,
    items,
    createdAt,
    updatedAt: createdAt,
  };
}

function resolveJobItemPrompt(job: SkillJob, item: SkillJobItem): string {
  if (typeof item.prompt === "string" && item.prompt.trim().length > 0) {
    return item.prompt;
  }

  if (job.skillType === "logo") {
    const brandName = typeof job.metadata.brandName === "string" ? job.metadata.brandName : "MyBrand";
    const industry = typeof job.metadata.industry === "string" ? job.metadata.industry : "咖啡";
    return generateLogoPrompt(item.key, brandName, industry);
  }

  if (job.skillType === "brand") {
    const metadata = job.metadata as unknown as BrandJobMetadata;
    const brandName = metadata.brandName || "MyBrand";
    const industry = metadata.industry || "消费品";
    const brandBrief = metadata.brandBrief || "";
    const viGuide = metadata.viGuide || "";
    const userRequirement = metadata.userRequirement || "";
    const logoReferenceHint = metadata.logoReferenceHint || "Use provided logo as strict visual identity reference.";

    if (metadata.mode === "nine_grid") {
      const materials = Array.isArray(metadata.selectedMaterials) && metadata.selectedMaterials.length > 0
        ? metadata.selectedMaterials
        : [...DEFAULT_BRAND_MATERIAL_POOL.map((entry) => entry.key)].slice(0, 9);
      return buildNineGridPrompt(
        brandName,
        industry,
        materials,
        brandBrief,
        viGuide,
        userRequirement,
        logoReferenceHint
      );
    }

    const specificMaterials = Array.isArray(metadata.specificMaterials) ? metadata.specificMaterials : [];
    const match = item.key.match(/brand_material_(\d+)/);
    const index = match ? Math.max(0, Number(match[1]) - 1) : 0;
    const materialKey = specificMaterials[index] || metadata.selectedMaterials?.[index] || "tshirt";
    return buildSingleMaterialPrompt(
      brandName,
      industry,
      materialKey,
      brandBrief,
      viGuide,
      userRequirement,
      logoReferenceHint
    );
  }

  return "";
}

async function processJob(jobId: string): Promise<void> {
  const job = skillJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = Date.now();
  skillJobControllers.set(jobId, new Set<AbortController>());

  const concurrency =
    typeof job.metadata.concurrency === "number" && job.metadata.concurrency > 0
      ? Math.floor(job.metadata.concurrency)
      : DEFAULT_CONCURRENCY;

  for (let i = 0; i < job.items.length; i += concurrency) {
    if (job.cancelRequested) break;

    const batch = job.items.slice(i, i + concurrency);
    await Promise.all(batch.map(async (item) => {
      if (job.cancelRequested || job.status === "failed") {
        if (item.status === "queued" || item.status === "running") {
          item.status = "cancelled";
          item.error = "Cancelled by user";
        }
        return;
      }

      item.status = "running";
      const controller = new AbortController();
      skillJobControllers.get(jobId)?.add(controller);
      let resolvedPrompt = "";
      let rawReferenceImages: string[] = [];
      let normalizedReferenceImages: string[] = [];

      try {
        resolvedPrompt = resolveJobItemPrompt(job, item);
        if (!resolvedPrompt) {
          throw new Error(`Unable to build prompt for ${job.skillType}:${item.key}`);
        }

        rawReferenceImages = item.referenceImages || [];
        normalizedReferenceImages = await normalizeReferenceImages(rawReferenceImages);

        logDebug("[SKILL_JOB][REQ]", {
          jobId,
          skillType: job.skillType,
          itemKey: item.key,
          itemName: item.name,
          size: item.size,
          referenceCount: rawReferenceImages.length,
          referenceTypes: rawReferenceImages.map((ref) => getReferenceType(ref)),
          normalizedReferenceCount: normalizedReferenceImages.length,
          promptPreview: resolvedPrompt.slice(0, 160),
        });

        if (job.skillType === "brand" && normalizedReferenceImages.length === 0) {
          throw new Error("Missing logo reference image for brand generation");
        }

        const result = await runImageTask({
          model: IMAGE_MODEL,
          prompt: resolvedPrompt,
          size: item.size,
          images: normalizedReferenceImages,
          n: 1,
          executionMode: "async",
          signal: controller.signal,
        });

        if (!result.data?.length) {
          throw new Error("No image data returned");
        }

        const upstreamUrl = result.data[0].url;
        let saved: { filename: string; localUrl: string } | null = null;
        try {
          saved = await saveImageToLocal(upstreamUrl, item.key);
        } catch (saveError) {
          logBasic("[SKILL_JOB][WARN]", {
            jobId,
            skillType: job.skillType,
            itemKey: item.key,
            reason: "save_local_failed_fallback_to_upstream",
            error: saveError instanceof Error ? saveError.message : String(saveError),
          });
        }

        item.status = "completed";
        item.localUrl = saved?.localUrl || upstreamUrl;

        logDebug("[SKILL_JOB][RES]", {
          jobId,
          skillType: job.skillType,
          itemKey: item.key,
          status: "completed",
          localUrl: item.localUrl,
        });
      } catch (error) {
        if (controller.signal.aborted || job.cancelRequested) {
          item.status = "cancelled";
          item.error = "Cancelled by user";
        } else {
          void skillJobsLogger.error("job.item.error", "Skill job item generation error", {
            jobId,
            skillType: job.skillType,
            itemKey: item.key,
            itemName: item.name,
            size: item.size,
            referenceCount: rawReferenceImages.length,
            referenceTypes: rawReferenceImages.map((ref) => getReferenceType(ref)),
            normalizedReferenceCount: normalizedReferenceImages.length,
            promptPreview: resolvedPrompt.slice(0, 120),
            error: serializeError(error),
          });
          item.status = "failed";
          item.error = error instanceof Error ? error.message : "Generation failed";
        }
      } finally {
        skillJobControllers.get(jobId)?.delete(controller);
      }
    }));

    job.updatedAt = Date.now();
  }

  if (job.cancelRequested) {
    job.items.forEach((item) => {
      if (item.status === "queued" || item.status === "running") {
        item.status = "cancelled";
        item.error = "Cancelled by user";
      }
    });
    job.status = "cancelled";
  } else {
    const hasCompleted = job.items.some((item) => item.status === "completed");
    const hasFailed = job.items.some((item) => item.status === "failed");
    if (hasCompleted && hasFailed) {
      job.status = "partial";
    } else if (hasCompleted) {
      job.status = "completed";
    } else {
      job.status = "failed";
    }
  }

  job.updatedAt = Date.now();
  skillJobControllers.delete(jobId);
}

export function createSkillJob(skillType: string, payload: Record<string, unknown>): SkillJob {
  if (skillType !== "logo" && skillType !== "brand") {
    throw new Error(`Unsupported skillType: ${skillType}`);
  }

  const job = skillType === "brand" ? buildBrandJob(payload) : buildLogoJob(payload);
  skillJobs.set(job.id, job);
  processJob(job.id).catch((error) => {
    void skillJobsLogger.error("job.process.error", "Skill job processing error", {
      jobId: job.id,
      skillType: job.skillType,
      error: serializeError(error),
    });
  });
  return job;
}

export function getSkillJob(jobId: string): SkillJob | null {
  return skillJobs.get(jobId) || null;
}

export function listSkillJobs(skillType?: string): SkillJob[] {
  return Array.from(skillJobs.values())
    .filter((job) => !skillType || job.skillType === skillType)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
}

export function cancelSkillJob(jobId: string): boolean {
  const job = skillJobs.get(jobId);
  if (!job) return false;

  if (["completed", "failed", "partial", "cancelled"].includes(job.status)) {
    return true;
  }

  job.cancelRequested = true;
  job.status = "cancelled";
  job.updatedAt = Date.now();

  const controllers = skillJobControllers.get(jobId);
  if (controllers) {
    for (const controller of controllers) {
      controller.abort();
    }
  }

  return true;
}

export function toJobSummary(job: SkillJob): Record<string, unknown> {
  return {
    jobId: job.id,
    skillType: job.skillType,
    status: job.status,
    completed: job.items.filter((item) => item.status === "completed").length,
    failed: job.items.filter((item) => item.status === "failed").length,
    cancelled: job.items.filter((item) => item.status === "cancelled").length,
    total: job.items.length,
    metadata: job.metadata,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function toJobDetail(job: SkillJob): Record<string, unknown> {
  return {
    ...toJobSummary(job),
    items: job.items.map((item) => ({
      key: item.key,
      name: item.name,
      size: item.size,
      status: item.status,
      localUrl: item.localUrl,
      error: item.error,
    })),
  };
}
