import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import TablePage from "@/pages/table";
import AdminPage from "@/pages/admin";
import QRPage from "@/pages/qr";
import AuthPage from "@/pages/auth";
import NotFound from "@/pages/not-found";
import SessionEndedPage from "@/pages/session-ended";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import UsersPage from "@/pages/users";

function Router() {
  return (
    <Switch>
      {/* Make sure this route comes before the redirect */}
      <Route path="/request/:restaurantId/:tableId" component={TablePage} />
      <Route path="/session-ended" component={SessionEndedPage} />
      <Route path="/">
        <Redirect to="/admin" />
      </Route>
      <Route path="/auth" component={AuthPage} />
      <ProtectedRoute path="/admin" component={AdminPage} />
      <ProtectedRoute path="/qr" component={QRPage} />
      <ProtectedRoute path="/users" component={UsersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;