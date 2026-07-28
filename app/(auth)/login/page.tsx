import { LoginForm } from "@/components/login-form";
import Image from "next/image";

export default function LoginPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-carbon px-4 py-6 text-champana sm:py-10">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col items-center gap-3">
        <div className="relative z-10 w-full max-w-md pt-2 sm:pt-6">
          <LoginForm />
        </div>

        <div className="pointer-events-none relative min-h-[320px] w-full flex-1 overflow-hidden sm:min-h-[460px]">
          <Image
            src="/brand/mala-junta-logo.jpeg"
            alt="Mala Junta Bar"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover object-center opacity-75 mix-blend-screen [mask-image:radial-gradient(ellipse_at_center,black_26%,rgba(0,0,0,0.82)_48%,transparent_78%)]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#020201_0%,rgba(2,2,1,0.10)_28%,rgba(2,2,1,0.18)_66%,#020201_100%)]" />
        </div>
      </section>
    </main>
  );
}
