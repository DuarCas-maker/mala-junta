"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type OpcionSelectorBuscable = {
  value: string;
  label: string;
  busqueda?: string;
  disabled?: boolean;
};

type SelectorBuscableProps = {
  value: string;
  onChange: (value: string) => void;
  opciones: OpcionSelectorBuscable[];
  placeholder: string;
  busquedaPlaceholder?: string;
  sinResultados?: string;
  disabled?: boolean;
  permitirLimpiar?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function normalizarBusqueda(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function SelectorBuscable({
  value,
  onChange,
  opciones,
  placeholder,
  busquedaPlaceholder = "Escribe para buscar",
  sinResultados = "Sin coincidencias",
  disabled = false,
  permitirLimpiar = true,
  className = "",
  ariaLabel,
}: SelectorBuscableProps) {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [indiceActivo, setIndiceActivo] = useState(0);

  const seleccionada = opciones.find((opcion) => opcion.value === value) ?? null;
  const filtradas = useMemo(() => {
    const termino = normalizarBusqueda(consulta);
    if (!termino) return opciones;
    return opciones.filter((opcion) => normalizarBusqueda(`${opcion.label} ${opcion.busqueda ?? ""}`).includes(termino));
  }, [consulta, opciones]);

  useEffect(() => {
    function cerrarFuera(event: MouseEvent | TouchEvent) {
      if (!contenedorRef.current?.contains(event.target as Node)) {
        setAbierto(false);
        setConsulta("");
      }
    }

    document.addEventListener("mousedown", cerrarFuera);
    document.addEventListener("touchstart", cerrarFuera);
    return () => {
      document.removeEventListener("mousedown", cerrarFuera);
      document.removeEventListener("touchstart", cerrarFuera);
    };
  }, []);

  useEffect(() => {
    setIndiceActivo(0);
  }, [consulta, abierto]);

  function abrir() {
    if (disabled) return;
    setAbierto(true);
    setConsulta("");
    queueMicrotask(() => inputRef.current?.focus());
  }

  function seleccionar(opcion: OpcionSelectorBuscable) {
    if (opcion.disabled) return;
    onChange(opcion.value);
    setAbierto(false);
    setConsulta("");
  }

  function manejarTeclado(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAbierto(true);
      setIndiceActivo((actual) => Math.min(actual + 1, Math.max(filtradas.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndiceActivo((actual) => Math.max(actual - 1, 0));
    } else if (event.key === "Enter" && abierto && filtradas[indiceActivo]) {
      event.preventDefault();
      seleccionar(filtradas[indiceActivo]);
    } else if (event.key === "Escape") {
      setAbierto(false);
      setConsulta("");
    }
  }

  return (
    <div ref={contenedorRef} className={`relative min-w-0 ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-controls={listboxId}
          aria-label={ariaLabel ?? placeholder}
          aria-expanded={abierto}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={abierto ? consulta : seleccionada?.label ?? ""}
          onFocus={abrir}
          onClick={abrir}
          onChange={(event) => {
            setConsulta(event.target.value);
            setAbierto(true);
          }}
          onKeyDown={manejarTeclado}
          placeholder={abierto ? busquedaPlaceholder : placeholder}
          className="tap-target w-full rounded-md border border-antiguo/20 bg-carbon px-3 pr-16 text-crema placeholder:text-antiguo/50 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {permitirLimpiar && value && !disabled ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange("");
              setConsulta("");
              inputRef.current?.focus();
            }}
            className="absolute right-9 top-1/2 -translate-y-1/2 rounded px-1 text-sm font-black text-antiguo/70 hover:text-crema"
            aria-label="Limpiar selección"
          >
            ×
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => abierto ? setAbierto(false) : abrir()}
          disabled={disabled}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-antiguo/70 disabled:opacity-40"
          aria-label={abierto ? "Cerrar opciones" : "Abrir opciones"}
        >
          {abierto ? "▲" : "▼"}
        </button>
      </div>

      {abierto ? (
        <div id={listboxId} role="listbox" className="absolute z-[70] mt-1 max-h-72 w-full min-w-[260px] overflow-y-auto rounded-md border border-antiguo/25 bg-espresso p-1 shadow-2xl">
          {filtradas.map((opcion, index) => (
            <button
              key={opcion.value}
              type="button"
              role="option"
              aria-selected={opcion.value === value}
              disabled={opcion.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setIndiceActivo(index)}
              onClick={() => seleccionar(opcion)}
              className={[
                "block w-full rounded px-3 py-2 text-left text-sm disabled:opacity-40",
                index === indiceActivo ? "bg-oro text-carbon" : opcion.value === value ? "bg-antiguo/15 text-dorado" : "text-crema hover:bg-antiguo/10",
              ].join(" ")}
            >
              {opcion.label}
            </button>
          ))}
          {filtradas.length === 0 ? <p className="px-3 py-4 text-center text-sm text-antiguo/65">{sinResultados}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
