import { LoginForm } from "@/components/login-form";
import Image from "next/image";

export default function LoginPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-carbon px-4 py-6 text-champana sm:py-10">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col items-center gap-6">
        <div className="w-full max-w-md pt-2 sm:pt-6">
          <LoginForm />
        </div>

        <div className="relative min-h-[300px] w-full flex-1 overflow-hidden rounded-lg border border-antiguo/10 bg-carbon shadow-suave sm:min-h-[420px]">
          <Image
            src="/brand/mala-junta-logo.jpeg"
            alt="Mala Junta Bar"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover object-center opacity-80 mix-blend-screen"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(2,2,1,0.18)_48%,rgba(2,2,1,0.78)_100%)]" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-carbon to-transparent" />
        </div>
      </section>
    </main>
  );
}
