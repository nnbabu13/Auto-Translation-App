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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";

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

const sourceLanguages = [
  { value: "en", label: "English" },
  { value: "el", label: "Greek" },
  { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" },
  { value: "ru", label: "Russian" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
];

const formSchema = z.object({
  name: z.string().min(1, "Session name is required"),
  sourceLanguage: z.string().min(1, "Source language is required"),
  targetLanguage: z.string().min(1, "Target language is required"),
});

export default function SessionNew() {
  const [, setLocation] = useLocation();
  const createSession = useCreateSession();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      sourceLanguage: "en",
      targetLanguage: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createSession.mutate(
      {
        data: {
          ...values,
          targetLanguages: [values.targetLanguage],
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
                    <FormLabel className="text-lg text-white">Session Name</FormLabel>
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
                name="sourceLanguage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg text-white">Source Language (Spoken in movie)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-14 text-lg bg-input border-border focus:ring-primary" data-testid="select-source-language">
                          <SelectValue placeholder="Select source language..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover border-popover-border text-popover-foreground">
                        {sourceLanguages.map((lang) => (
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

              <FormField
                control={form.control}
                name="targetLanguage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-lg text-white">Target Language (Translate to)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-14 text-lg bg-input border-border focus:ring-primary" data-testid="select-target-language">
                          <SelectValue placeholder="Select target language..." />
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
