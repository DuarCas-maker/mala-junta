import { LoginForm } from "@/components/login-form";
import Image from "next/image";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <section className="grid w-full max-w-6xl gap-8 md:grid-cols-[1fr_420px] md:items-center">
        <div className="relative min-h-[340px] overflow-hidden rounded-lg bg-carbon md:min-h-[520px]">
          <Image
            src="/brand/mala-junta-logo.jpeg"
            alt="Mala Junta Bar"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 680px"
            className="object-cover opacity-95 mix-blend-screen"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_22%,rgba(2,2,1,0.18)_58%,rgba(2,2,1,0.82)_100%)]" />
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
