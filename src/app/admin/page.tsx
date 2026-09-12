import type { Metadata } from "next";
import AdminControl from "@/components/admin-control";
export const metadata: Metadata = {
  title: "تحكم المالك | المصطفى",
};
export default function AdminPage() {
  return <AdminControl />;
}