import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Workspace configuration, Google Sheets linking, and BYOK notice."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">Groq API key (BYOK)</CardTitle>
            <CardDescription>
              Your Groq key is requested per session and never stored on the
              server. Paste it in the “Connect Groq” dialog before running a
              campaign.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Model used: <span className="text-foreground">openai/gpt-oss-120b</span>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-base">Google Sheets</CardTitle>
            <CardDescription>
              Optional — connect a service account to push qualified leads to a
              sheet in 500-row batches.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Not configured.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
