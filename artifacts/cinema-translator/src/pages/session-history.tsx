import { useRoute, Link } from "wouter";
import { useGetSession, useListSessionLogs } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Download, Clock, Globe } from "lucide-react";
import { format } from "date-fns";

export default function SessionHistory() {
  const [, params] = useRoute("/sessions/:id/history");
  const sessionId = Number(params?.id);
  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, { query: { enabled: !!sessionId, queryKey: ['session', sessionId] }});
  const { data: logs, isLoading: logsLoading } = useListSessionLogs(sessionId, { query: { enabled: !!sessionId, queryKey: ['session-logs', sessionId] }});

  const handleExport = async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      
      const blob = new Blob([data.content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  };

  if (sessionLoading || logsLoading) {
    return <div className="min-h-screen bg-background text-foreground flex justify-center items-center font-mono tracking-widest">LOADING LOGS...</div>;
  }

  if (!session) return <div>Session not found</div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex items-center justify-between border-b border-border pb-6">
          <div className="flex items-center space-x-6">
            <Link href={`/sessions/${sessionId}`} className="inline-flex items-center text-muted-foreground hover:text-white transition-colors">
              <ArrowLeft className="h-6 w-6" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">{session.name}</h1>
              <p className="text-muted-foreground font-medium tracking-widest uppercase mt-1 text-sm">Session History</p>
            </div>
          </div>
          <Button 
            onClick={handleExport}
            variant="default" 
            size="lg"
            className="font-bold tracking-wider"
            data-testid="button-export-txt"
          >
            <Download className="mr-2 h-5 w-5" />
            EXPORT TXT
          </Button>
        </header>

        <div className="space-y-6">
          {logs && logs.length > 0 ? (
            logs.map((log) => (
              <Card key={log.id} className="bg-card border-card-border overflow-hidden" data-testid={`log-item-${log.id}`}>
                <CardContent className="p-0">
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    <div className="p-6 border-b md:border-b-0 md:border-r border-border bg-sidebar/50">
                      <div className="flex items-center justify-between mb-4 text-xs font-mono text-muted-foreground">
                        <span className="flex items-center uppercase"><Globe className="w-3 h-3 mr-1" /> {log.sourceLanguage}</span>
                        <span className="flex items-center"><Clock className="w-3 h-3 mr-1" /> {format(new Date(log.timestamp), 'HH:mm:ss')}</span>
                      </div>
                      <p className="text-lg text-muted-foreground leading-relaxed">{log.originalText}</p>
                    </div>
                    <div className="p-6 bg-card">
                      <div className="flex items-center justify-between mb-4 text-xs font-mono text-primary">
                        <span className="flex items-center uppercase"><Globe className="w-3 h-3 mr-1" /> {log.targetLanguage}</span>
                      </div>
                      <p className="text-xl font-medium text-white leading-relaxed">{log.translatedText}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-center py-24 bg-card rounded-lg border border-border border-dashed">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-medium text-white mb-2">No translation logs yet</h3>
              <p className="text-muted-foreground">Return to the session screen and start recording to generate logs.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
