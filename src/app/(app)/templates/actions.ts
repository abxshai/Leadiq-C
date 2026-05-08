"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export type TemplateInput = {
  name: string;
  description: string | null;
  system_prompt: string;
  is_default: boolean;
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return base.length > 0 ? base : "template";
}

function validate(input: TemplateInput) {
  const name = input.name.trim();
  const systemPrompt = input.system_prompt.trim();
  if (name.length === 0) throw new Error("Name is required.");
  if (name.length > 80) throw new Error("Name must be 80 characters or fewer.");
  if (systemPrompt.length < 10) {
    throw new Error("System prompt must be at least 10 characters.");
  }
  return {
    name,
    description: input.description?.trim() || null,
    system_prompt: systemPrompt,
    is_default: input.is_default,
  };
}

// Atomic-ish "set default": clear all defaults except this id, then set this
// one. Two-statement window is acceptable at 5-person team scale per the
// project's trust model — see DOCS.md §7.
async function clearOtherDefaults(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  exceptId: string | null
) {
  const q = supabase
    .from("prompt_templates")
    .update({ is_default: false })
    .eq("is_default", true);
  if (exceptId) q.neq("id", exceptId);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function createTemplate(input: TemplateInput) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const clean = validate(input);

  if (clean.is_default) await clearOtherDefaults(supabase, null);

  // Unique-slug retry: try the friendly slug; if taken, append a short
  // random suffix. Postgres unique-violation = 23505.
  const baseSlug = slugify(clean.name);
  let createdId: string | null = null;
  for (let attempt = 0; attempt < 3 && !createdId; attempt++) {
    const candidate =
      attempt === 0
        ? baseSlug
        : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const { data, error } = await supabase
      .from("prompt_templates")
      .insert({
        name: clean.name,
        slug: candidate,
        description: clean.description,
        system_prompt: clean.system_prompt,
        is_default: clean.is_default,
        version: 1,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (!error && data) {
      createdId = data.id;
      break;
    }
    if (error?.code !== "23505") {
      throw new Error(error?.message ?? "Failed to create template.");
    }
  }
  if (!createdId) {
    throw new Error("Could not generate a unique slug — try a different name.");
  }

  // Seed v1 in the version history table.
  await supabase.from("prompt_template_versions").insert({
    template_id: createdId,
    version: 1,
    name: clean.name,
    system_prompt: clean.system_prompt,
    saved_by: user.id,
  });

  revalidatePath("/templates");
  revalidatePath("/campaigns/new");
  redirect(`/templates/${createdId}`);
}

export async function updateTemplate(id: string, input: TemplateInput) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const clean = validate(input);

  const { data: existing, error: readErr } = await supabase
    .from("prompt_templates")
    .select("id, name, system_prompt, version, is_default")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) throw new Error("Template not found.");

  const promptChanged = existing.system_prompt !== clean.system_prompt;
  const nameChanged = existing.name !== clean.name;
  const nextVersion =
    promptChanged || nameChanged ? existing.version + 1 : existing.version;

  if (clean.is_default && !existing.is_default) {
    await clearOtherDefaults(supabase, id);
  }

  const { error: updErr } = await supabase
    .from("prompt_templates")
    .update({
      name: clean.name,
      description: clean.description,
      system_prompt: clean.system_prompt,
      is_default: clean.is_default,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  if (nextVersion !== existing.version) {
    const { error: vErr } = await supabase
      .from("prompt_template_versions")
      .insert({
        template_id: id,
        version: nextVersion,
        name: clean.name,
        system_prompt: clean.system_prompt,
        saved_by: user.id,
      });
    if (vErr) throw new Error(vErr.message);
  }

  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
  revalidatePath("/campaigns/new");
}

export async function archiveTemplate(id: string) {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("prompt_templates")
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/templates");
  revalidatePath("/campaigns/new");
}

export async function unarchiveTemplate(id: string) {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("prompt_templates")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/templates");
  revalidatePath("/campaigns/new");
}

export async function duplicateTemplate(id: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const { data: src, error: readErr } = await supabase
    .from("prompt_templates")
    .select("name, description, system_prompt")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!src) throw new Error("Template not found.");

  await createTemplate({
    name: `Copy of ${src.name}`,
    description: src.description,
    system_prompt: src.system_prompt,
    is_default: false,
  });
}

export async function setDefaultTemplate(id: string) {
  const supabase = await createServerSupabase();
  await clearOtherDefaults(supabase, id);
  const { error } = await supabase
    .from("prompt_templates")
    .update({ is_default: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/templates");
  revalidatePath("/campaigns/new");
}

export async function restoreVersion(templateId: string, versionNumber: number) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const { data: version, error: readErr } = await supabase
    .from("prompt_template_versions")
    .select("name, system_prompt")
    .eq("template_id", templateId)
    .eq("version", versionNumber)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!version) throw new Error("Version not found.");

  const { data: cur, error: curErr } = await supabase
    .from("prompt_templates")
    .select("description, is_default")
    .eq("id", templateId)
    .maybeSingle();
  if (curErr) throw new Error(curErr.message);
  if (!cur) throw new Error("Template not found.");

  await updateTemplate(templateId, {
    name: version.name,
    description: cur.description,
    system_prompt: version.system_prompt,
    is_default: cur.is_default,
  });
}
