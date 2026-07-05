import { useAuth } from "@workspace/replit-auth-web";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGetSessionStats, useListSessions } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutDashboard, Plus, History, Mic, Activity } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useGetSessionStats();
  const { data: sessions, isLoading: sessionsLoading } = useListSessions();

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">
              Cinema AI Translator
            </h1>
            <p className="text-muted-foreground text-lg">
              Welcome back, {user?.firstName || "Reviewer"}.
            </p>
          </div>
          <Link href="/sessions/new">
            <Button size="lg" className="h-14 px-8 text-lg font-medium shadow-xl" data-testid="button-new-session">
              <Plus className="mr-2 h-6 w-6" />
              New Session
            </Button>
          </Link>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Sessions</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-10 w-24 bg-muted" />
              ) : (
                <div className="text-5xl font-bold text-white" data-testid="text-total-sessions">{stats?.totalSessions || 0}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Translations</CardTitle>
              <History className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-10 w-24 bg-muted" />
              ) : (
                <div className="text-5xl font-bold text-white" data-testid="text-total-logs">{stats?.totalLogs || 0}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-6 text-white">Recent Sessions</h2>
          {sessionsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full bg-muted rounded-lg" />
              ))}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {sessions.map((session) => (
                <Card key={session.id} className="bg-card border-card-border hover:border-primary/50 transition-colors group" data-testid={`card-session-${session.id}`}>
                  <CardContent className="p-6 flex items-center justify-between">
                    <Link href={`/sessions/${session.id}`} className="flex items-center space-x-6 flex-1 cursor-pointer">
                      <div className="bg-muted p-4 rounded-full group-hover:bg-primary/20 group-hover:text-primary transition-colors text-muted-foreground">
                        <Mic className="h-8 w-8" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-white mb-1">{session.name}</h3>
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span className="flex items-center">
                            Target: <span className="ml-1 text-primary">{session.targetLanguage}</span>
                          </span>
                          <span>&bull;</span>
                          <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                          <span>&bull;</span>
                          <span>{session.logCount} logs</span>
                        </div>
                      </div>
                    </Link>
                    <div className="flex items-center space-x-4">
                      <Link href={`/sessions/${session.id}/history`}>
                        <Button variant="secondary" size="lg" className="h-12" data-testid={`button-history-${session.id}`}>
                          History
                        </Button>
                      </Link>
                      <Link href={`/sessions/${session.id}`}>
                        <Button variant="default" size="lg" className="h-12" data-testid={`button-resume-${session.id}`}>
                          Resume
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-24 bg-card rounded-lg border border-card-border border-dashed">
              <Mic className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-medium text-white mb-2">No sessions yet</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Create your first translation session to start processing audio in real-time.
              </p>
              <Link href="/sessions/new">
                <Button size="lg" data-testid="button-create-first">Create Session</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
