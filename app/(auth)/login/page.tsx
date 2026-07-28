import { LoginForm } from "@/components/login-form";
import Image from "next/image";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-carbon px-4 py-8">
      <Image
        src="/brand/mala-junta-logo.jpeg"
        alt="Mala Junta Bar"
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-35 mix-blend-screen"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(177,133,93,0.18),transparent_28rem),linear-gradient(90deg,rgba(2,2,1,0.92)_0%,rgba(2,2,1,0.58)_52%,rgba(2,2,1,0.86)_100%)]" />
      <section className="relative z-10 grid w-full max-w-5xl gap-6 md:grid-cols-[minmax(0,1fr)_420px] md:items-center">
        <div className="hidden min-h-[360px] md:block" aria-hidden="true" />
        <LoginForm />
      </section>
    </main>
  );
}
