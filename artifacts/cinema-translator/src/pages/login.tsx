import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { AudioLines } from "lucide-react";

export default function Login() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex justify-center mb-8">
          <div className="bg-card p-6 rounded-full border border-border shadow-2xl">
            <AudioLines className="h-16 w-16 text-primary" />
          </div>
        </div>
        
        <div className="space-y-2">
          <h1 className="text-5xl font-extrabold tracking-tight text-white">Cinema AI</h1>
          <p className="text-xl text-muted-foreground tracking-wide uppercase font-medium">
            Real-Time Translation
          </p>
        </div>

        <div className="pt-12">
          <Button 
            onClick={login} 
            size="lg" 
            className="w-full h-16 text-lg font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-lg"
            data-testid="button-login"
          >
            Sign in to continue
          </Button>
          <p className="mt-6 text-sm text-muted-foreground">
            Professional access only. Unauthorized use is prohibited.
          </p>
        </div>
      </div>
    </div>
  );
}
