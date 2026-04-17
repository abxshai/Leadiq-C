import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

const seedTemplates = [
  {
    name: "Robotics / Manufacturing AI",
    description:
      "Deccan AI's default ICP — targets AI-driven robotics, manipulation, and manufacturing training-data pipelines.",
    isDefault: true,
  },
  {
    name: "General B2B",
    description:
      "Neutral qualifier with no vertical bias. Useful for lists outside core ICPs.",
    isDefault: false,
  },
];

export default function TemplatesPage() {
  return (
    <div>
      <PageHeader
        title="Prompt templates"
        description="Saved system prompts you can pick when launching a campaign. Campaigns snapshot the version at run time so edits never change historical results."
        actions={
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            New template
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {seedTemplates.map((t) => (
          <Card
            key={t.name}
            className="bg-card/40 hover:bg-card/60 transition-colors"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/25">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <CardTitle className="text-base">{t.name}</CardTitle>
                </div>
                {t.isDefault ? (
                  <Badge
                    variant="outline"
                    className="border-primary/40 bg-primary/10 text-primary"
                  >
                    Default
                  </Badge>
                ) : null}
              </div>
              <CardDescription className="pt-2">{t.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" size="sm">
                Edit
              </Button>
              <Button variant="ghost" size="sm">
                Duplicate
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
