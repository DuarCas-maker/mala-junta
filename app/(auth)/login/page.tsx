import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="grid w-full max-w-5xl gap-8 md:grid-cols-[1fr_420px] md:items-center">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-acento">Mala Junta POS</p>
          <h1 className="mt-3 text-4xl font-black leading-tight text-tinta sm:text-5xl">Entrada operativa</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-black/65">
            Acceso inicial para administrador, caja y meseros. La fase F0 deja lista la identidad, roles y base de seguridad.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
