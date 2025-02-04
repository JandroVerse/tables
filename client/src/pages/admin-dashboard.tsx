import { UserManagement } from "@/components/user-management";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedBackground } from "@/components/animated-background";

export default function AdminDashboard() {
  const { user } = useAuth();

  if (!user?.isAdmin) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen">
      <div className="relative z-0">
        <AnimatedBackground />
      </div>
      <div className="relative z-10 container mx-auto py-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <Link href="/admin">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button variant="outline" className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Restaurant Dashboard
              </Button>
            </motion.div>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>User Management</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-6">
              Manage users, permissions, and system settings.
            </p>
            <UserManagement />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}