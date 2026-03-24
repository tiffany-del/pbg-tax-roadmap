import { Switch, Route, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Router } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useState } from "react";
import Dashboard from "@/pages/Dashboard";
import ClientWorkflow from "@/pages/ClientWorkflow";
import QuizForm from "@/pages/QuizForm";
import QuizReview from "@/pages/QuizReview";
import NotFound from "@/pages/not-found";
import Login, { isAuthenticated, setAuthenticated } from "@/pages/Login";

// Public routes that don't require a password
const PUBLIC_PATHS = ["/quiz"];

function AuthGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isPublic = PUBLIC_PATHS.some(p => location === p || location.startsWith(p + "/"));
  const [authed, setAuthed] = useState(isAuthenticated());

  if (isPublic || authed) return <>{children}</>;

  return <Login onSuccess={() => { setAuthenticated(); setAuthed(true); }} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AuthGate>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/client/:id" component={ClientWorkflow} />
            <Route path="/quiz" component={QuizForm} />
            <Route path="/quiz/:id" component={QuizReview} />
            <Route component={NotFound} />
          </Switch>
        </AuthGate>
      </Router>
      <Toaster />
      <PerplexityAttribution />
    </QueryClientProvider>
  );
}
