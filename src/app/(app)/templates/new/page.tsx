import { PageHeader } from "@/components/page-header";
import { TemplateForm } from "@/components/template-form";

export default function NewTemplatePage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New prompt template"
        description="Templates are reusable system prompts. Pick this one in the campaign wizard and the agent runs against the prompt you write here."
      />
      <TemplateForm />
    </div>
  );
}
