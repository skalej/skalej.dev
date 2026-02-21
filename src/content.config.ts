import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { SITE } from "@/config";

export const BLOG_PATH = "src/data/blog";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: `./${BLOG_PATH}` }),
  schema: ({ image }) =>
    z.object({
      author: z.string().default(SITE.author),
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),
      title: z.string(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).default(["others"]),
      ogImage: image().or(z.string()).optional(),
      description: z.string(),
      canonicalURL: z.string().optional(),
      hideEditPost: z.boolean().optional(),
      timezone: z.string().optional(),
    }),
});

export const PROJECTS_PATH = "src/data/projects";

const projects = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: `./${PROJECTS_PATH}` }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      descriptionDe: z.string().optional(),
      pubDatetime: z.date(),
      techStack: z.array(z.string()).default([]),
      liveUrl: z.string().optional(),
      githubUrl: z.string().optional(),
      image: image().or(z.string()).optional(),
      logo: image().or(z.string()).optional(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
      keywords: z.array(z.string()).default([]),
    }),
});

export const collections = { blog, projects };
