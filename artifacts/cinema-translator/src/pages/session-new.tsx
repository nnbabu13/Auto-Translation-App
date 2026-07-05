import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation, Link } from "wouter";
import { useCreateSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, X } from "lucide-react";

const languages = [
  { value: "English", label: "English" },
  { value: "Greek", label: "Greek" },
  { value: "Hindi", label: "Hindi" },
  { value: "Telugu", label: "Telugu" },
  { value: "Russian", label: "Russian" },
  { value: "German", label: "German" },
  { value: "French", label: "French" },
  { value: "Arabic", label: "Arabic" },
  { value: "Spanish", label: "Spanish" },
  { value: "Italian", label: "Italian" },
  { value: "Portuguese", label: "Portuguese" },
  { value: "Japanese", label: "Japanese" },
  { value: "Korean", label: "Korean" },
  { value: "Chinese", label: "Chinese" },
];

const formSchema = z.object({
  name: z.string().min(1, "Session name is required"),
  targetLanguage: z.string().min(1, "Primary target language is required"),
});

export default function SessionNew() {
  const [, setLocation] = useLocation();
  const createSession = useCreateSession();
  const [additionalLanguages, setAdditionalLanguages] = useState<string[]>([]);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      targetLanguage: "",
    },
  });

  const primaryLanguage = form.watch("targetLanguage");

  const availableLanguages = languages.filter(
    (l) => l.value !== primaryLanguage && !additionalLanguages.includes(l.value)
  );

  function addLanguage(lang: string) {
    setAdditionalLanguages((prev) => [...prev, lang]);
    setShowLanguagePicker(false);
  }

  function removeLanguage(lang: string) {
    setAdditionalLanguages((prev) => prev.filter((l) => l !== lang));
  }

  function onSubmit(values: z.infer<typeof formSchema>) {
    const allLanguages = [values.targetLanguage, ...additionalLanguages];
    createSession.mutate(
      {
        data: {
          ...values,
          targetLanguages: allLanguages,
        } as any,
      },
      {
        onSuccess: (session) => {
          setLocation(`/sessions/${session.id}`);
        },
      }
    );
  }

  return (
    <div className="min-h-screen bg-background p-8 flex flex-col items-center">
      <div className="w-full max-w-2xl mt-12">
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-white transition-colors mb-6" data-testid="link-back">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Dashboard
          </Link>
          <h1 className="text-4xl font-bold text-white">Configure Session</h1>
          <p className="text-muted-foreground text-lg mt-2">Set up a new real-time translation context.</p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-8 shadow-2xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg text-white">Session Identifier</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g. Director's Cut Review - Reel 1" 
                        className="h-14 text-lg bg-input border-border focus-visible:ring-primary" 
                        data-testid="input-session-name"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetLanguage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg text-white">Primary Target Language</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-14 text-lg bg-input border-border focus:ring-primary" data-testid="select-target-language">
                          <SelectValue placeholder="Select primary language..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover border-popover-border text-popover-foreground">
                        {languages.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value} className="text-lg py-3 cursor-pointer">
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <Label className="text-lg text-white">Additional Languages (Optional)</Label>
                <p className="text-sm text-muted-foreground mb-3">Select additional languages to translate into simultaneously.</p>

                {additionalLanguages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {additionalLanguages.map((lang) => (
                      <div
                        key={lang}
                        className="flex items-center gap-1 bg-primary/20 text-primary px-3 py-1 rounded-full text-sm"
                      >
                        {lang}
                        <button
                          type="button"
                          onClick={() => removeLanguage(lang)}
                          className="hover:text-primary/80"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showLanguagePicker ? (
                  <Select onValueChange={addLanguage}>
                    <SelectTrigger className="h-12 bg-input border-border focus:ring-primary">
                      <SelectValue placeholder="Add a language..." />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-popover-border text-popover-foreground">
                      {availableLanguages.map((lang) => (
                        <SelectItem key={lang.value} value={lang.value} className="text-lg py-3 cursor-pointer">
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowLanguagePicker(true)}
                    disabled={!primaryLanguage || availableLanguages.length === 0}
                    className="border-dashed"
                  >
                    + Add Language
                  </Button>
                )}
              </div>

              <div className="pt-4 flex justify-end">
                <Button 
                  type="submit" 
                  size="lg" 
                  className="h-16 px-12 text-xl font-bold"
                  disabled={createSession.isPending}
                  data-testid="button-submit-session"
                >
                  {createSession.isPending ? "INITIALIZING..." : "INITIALIZE SESSION"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
