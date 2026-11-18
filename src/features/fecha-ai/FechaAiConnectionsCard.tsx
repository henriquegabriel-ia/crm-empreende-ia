import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Copy, KeyRound, Link2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ds/dialog';
import {
  FECHA_READ_SCOPES,
  fechaConnectionsApi,
  fechaAdminError,
  fechaLoadNotice,
  isFechaAdminAbort,
  readScopesOf,
  type FechaActor,
  type FechaAdminContext,
  type FechaAdminScope,
  type FechaConnection,
  type FechaReadScope,
} from './api';

export interface FechaAiConnectionsCardProps extends FechaAdminScope {
  canManage: boolean;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dateLabel = (value: string) => new Date(value).toLocaleString('pt-BR');
function localDate(value: number) {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function ActorChoices({
  actors,
  selected,
  disabled,
  onChange,
  label,
}: {
  actors: FechaActor[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  label: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const visible = actors.filter((actor) =>
    actor.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')),
  );
  const missing = selected.filter((actorId) => !actors.some((actor) => actor.id === actorId));
  function toggle(actorId: string) {
    onChange(selected.includes(actorId) ? selected.filter((item) => item !== actorId) : [...selected, actorId]);
  }
  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border border-border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <label htmlFor={`${id}-filter`} className="block text-xs text-muted-foreground">
        Filtrar integrantes pelo nome
      </label>
      <Input
        id={`${id}-filter`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        maxLength={120}
        placeholder="Nome do integrante no CRM"
      />
      <div className="max-h-60 space-y-1 overflow-y-auto">
        {visible.map((actor) => (
          <label
            key={actor.id}
            className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-muted/50"
          >
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={selected.includes(actor.id)}
              onChange={() => toggle(actor.id)}
            />
            <span className="min-w-0 break-words">{actor.label}</span>
          </label>
        ))}
        {!visible.length && (
          <p className="text-sm text-muted-foreground">Nenhum integrante disponível com esse nome.</p>
        )}
        {missing.map((actorId, index) => (
          <label key={actorId} className="flex items-start gap-2 p-2 text-sm">
            <input type="checkbox" className="mt-1 accent-primary" checked onChange={() => toggle(actorId)} />
            Identidade indisponível {index + 1}; desmarque para removê-la.
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.length} identidade(s) selecionada(s). A Fecha IA poderá vincular seus integrantes somente a essas
        identidades.
      </p>
    </fieldset>
  );
}
// As leituras da Fecha IA (item B20 da Fecha IA; supabase/functions/README.md, "Leituras"), desligadas por padrão.
const READ_LABELS: Record<FechaReadScope, { title: string; detail: string }> = {
  context: {
    title: 'Contexto dos registros',
    detail:
      'Na preparação e na reunião, o vendedor vê o contato (nome, situação e “Não contatar”), a empresa, a oportunidade (fase, situação e motivo de perda), até 10 compromissos em aberto e as 10 últimas atividades, com trechos de até 500 caracteres.',
  },
  outcomes: {
    title: 'Resultados das oportunidades',
    detail:
      'Nos indicadores do gestor na Fecha IA: a situação, a fase, a data de fechamento e a do primeiro recebimento pago das oportunidades das reuniões, sem título nem valor.',
  },
};
function readSummary(scopes: FechaReadScope[]) {
  const labels = FECHA_READ_SCOPES.filter((scope) => scopes.includes(scope)).map((scope) =>
    READ_LABELS[scope].title.toLocaleLowerCase('pt-BR'),
  );
  return labels.length ? labels.join(' e ') : 'nenhuma (só registra notas e tarefas)';
}
function ReadChoices({
  selected,
  disabled,
  onChange,
}: {
  selected: FechaReadScope[];
  disabled: boolean;
  onChange: (scopes: FechaReadScope[]) => void;
}) {
  const id = useId();
  function toggle(scope: FechaReadScope) {
    onChange(
      FECHA_READ_SCOPES.filter((item) => (item === scope ? !selected.includes(scope) : selected.includes(item))),
    );
  }
  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-xl border border-border p-3"
      disabled={disabled}
      aria-describedby={`${id}-note`}
    >
      <legend className="px-1 text-sm font-medium">Leituras permitidas à Fecha IA</legend>
      {FECHA_READ_SCOPES.map((scope) => (
        // O rótulo só com o nome da leitura; o que ela leva fica na descrição do campo.
        <div key={scope} className="flex min-w-0 items-start gap-2 rounded-lg p-2 text-sm">
          <input
            id={`${id}-${scope}-choice`}
            type="checkbox"
            className="mt-1 accent-primary"
            checked={selected.includes(scope)}
            aria-describedby={`${id}-${scope}`}
            onChange={() => toggle(scope)}
          />
          <span className="min-w-0">
            <label htmlFor={`${id}-${scope}-choice`} className="block cursor-pointer font-medium">
              {READ_LABELS[scope].title}
            </label>
            <span id={`${id}-${scope}`} className="block text-xs text-muted-foreground">
              {READ_LABELS[scope].detail}
            </span>
          </span>
        </div>
      ))}
      <p id={`${id}-note`} className="text-xs text-muted-foreground">
        Opcionais e desligadas por padrão: sem elas, a Fecha IA só registra notas e tarefas. E-mails, telefones e
        observações dos contatos nunca saem do CRM. Cada leitura fica registrada no banco do CRM, com limite de 30 por
        minuto por conexão.
      </p>
    </fieldset>
  );
}
export function FechaAiConnectionsCard(props: FechaAiConnectionsCardProps) {
  if (!props.canManage || !props.organizationId || !props.userId)
    return (
      <section className="space-y-2 rounded-2xl border border-border p-5">
        <h2 className="text-lg font-semibold">Fecha IA</h2>
        <p className="text-sm text-muted-foreground">
          Donos e administradores podem autorizar a Fecha IA a registrar revisões comerciais como notas e tarefas nesta
          organização.
        </p>
      </section>
    );
  return <ConnectionsCard key={`${props.organizationId}:${props.userId}`} {...props} />;
}
function ConnectionsCard({ organizationId, userId, canManage }: FechaAiConnectionsCardProps) {
  const id = useId();
  const latest = useRef({ organizationId, userId, canManage });
  latest.current = { organizationId, userId, canManage };
  const alive = useRef(true),
    controller = useRef<AbortController | null>(null);
  const begin = useCallback((): FechaAdminContext => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const captured = latest.current;
    return {
      scope: captured,
      signal: current.signal,
      isCurrent: () =>
        alive.current &&
        !current.signal.aborted &&
        latest.current.canManage &&
        latest.current.organizationId === captured.organizationId &&
        latest.current.userId === captured.userId,
    };
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const [connections, setConnections] = useState<FechaConnection[]>([]),
    [actors, setActors] = useState<FechaActor[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    // A leitura não alcançou a função de gerenciamento (não publicada neste CRM, ou a origem fora de
    // CRM_ALLOWED_ORIGINS): um aviso neutro, sem o formulário nem a lista (fechaLoadNotice).
    [unavailable, setUnavailable] = useState('');
  const [name, setName] = useState(''),
    [sourceOrganizationId, setSourceOrganizationId] = useState(''),
    [expiresAt, setExpiresAt] = useState(''),
    [allowedActorIds, setAllowedActorIds] = useState<string[]>([]),
    [readScopes, setReadScopes] = useState<FechaReadScope[]>([]);
  const [secret, setSecret] = useState<{ connection: FechaConnection; token: string } | null>(null);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'revoke' | 'actors' | 'reads'; connection: FechaConnection } | null>(
    null,
  );
  const [editingActors, setEditingActors] = useState<string[]>([]);
  const [editingReads, setEditingReads] = useState<FechaReadScope[]>([]);
  const secretTitle = useRef<HTMLHeadingElement>(null);
  const sectionTitle = useRef<HTMLHeadingElement>(null),
    dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (secret) secretTitle.current?.focus();
  }, [secret]);
  useEffect(() => {
    const future = connections
      .filter((connection) => !connection.revokedAt)
      .map((connection) => new Date(connection.expiresAt).getTime())
      .filter((time) => time > now);
    if (!future.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(60_000, Math.min(...future) - Date.now())));
    return () => clearTimeout(timer);
  }, [connections, now]);
  useEffect(() => {
    const request = begin();
    void Promise.all([fechaConnectionsApi.list(request), fechaConnectionsApi.actors(request)])
      .then(([list, options]) => {
        if (request.isCurrent()) {
          setConnections(list.connections);
          setActors(options.actors);
        }
      })
      .catch((cause) => {
        if (!request.isCurrent() || isFechaAdminAbort(cause)) return;
        const notice = fechaLoadNotice(cause);
        if (notice) setUnavailable(notice);
        else setError(fechaAdminError(cause));
      })
      .finally(() => {
        if (request.isCurrent()) setLoading(false);
      });
  }, [begin]);
  async function refresh() {
    if (busy || loading) return;
    const request = begin();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const [list, options] = await Promise.all([
        fechaConnectionsApi.list(request),
        fechaConnectionsApi.actors(request),
      ]);
      if (request.isCurrent()) {
        setConnections(list.connections);
        setActors(options.actors);
        setCreateUncertain(false);
        setUnavailable('');
      }
    } catch (cause) {
      if (!request.isCurrent() || isFechaAdminAbort(cause)) return;
      const notice = fechaLoadNotice(cause);
      if (notice) setUnavailable(notice);
      else setError(fechaAdminError(cause));
    } finally {
      if (request.isCurrent()) setBusy(false);
    }
  }
  function adopt(connection: FechaConnection) {
    setConnections((current) => [connection, ...current.filter((item) => item.id !== connection.id)]);
  }
  async function create() {
    if (busy || loading || secret || createUncertain || !canManage) return;
    setError('');
    setNotice('');
    const expiration = new Date(expiresAt).getTime();
    if (
      !name.trim() ||
      !uuidPattern.test(sourceOrganizationId.trim()) ||
      !allowedActorIds.length ||
      !Number.isFinite(expiration) ||
      expiration < Date.now() + 3_600_000 ||
      expiration > Date.now() + 90 * 86_400_000
    ) {
      setError(
        'Preencha o nome, o identificador da equipe Fecha IA, ao menos uma identidade e uma validade entre 1 hora e 90 dias.',
      );
      return;
    }
    const request = begin();
    setBusy(true);
    try {
      const result = await fechaConnectionsApi.create(request, {
        name: name.trim(),
        sourceOrganizationId: sourceOrganizationId.trim(),
        allowedActorIds,
        expiresAt: new Date(expiration).toISOString(),
        readScopes,
      });
      if (!request.isCurrent()) return;
      adopt(result.connection);
      setSecret({ connection: result.connection, token: result.token });
      setName('');
      setSourceOrganizationId('');
      setAllowedActorIds([]);
      setReadScopes([]);
      setExpiresAt('');
    } catch (cause) {
      if (request.isCurrent() && !isFechaAdminAbort(cause)) {
        setError(fechaAdminError(cause));
        setCreateUncertain(true);
      }
    } finally {
      if (request.isCurrent()) setBusy(false);
    }
  }
  async function saveDialog() {
    if (!dialog || busy || !canManage || (dialog.mode === 'actors' && !editingActors.length)) return;
    const request = begin();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result =
        dialog.mode === 'revoke'
          ? await fechaConnectionsApi.revoke(request, dialog.connection.id)
          : dialog.mode === 'reads'
            ? await fechaConnectionsApi.setReadScopes(request, dialog.connection.id, editingReads)
            : await fechaConnectionsApi.setActors(request, dialog.connection.id, editingActors);
      if (!request.isCurrent()) return;
      adopt(result.connection);
      setDialog(null);
      if (dialog.mode === 'revoke') {
        if (secret?.connection.id === dialog.connection.id) setSecret(null);
        setNotice('Conexão revogada. A credencial não autoriza novos registros no CRM.');
      } else
        setNotice(
          dialog.mode === 'reads' ? 'Leituras da Fecha IA atualizadas.' : 'Identidades autorizadas atualizadas.',
        );
    } catch (cause) {
      if (request.isCurrent() && !isFechaAdminAbort(cause)) setError(fechaAdminError(cause));
    } finally {
      if (request.isCurrent()) setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    if (!alive.current || !latest.current.canManage) return;
    try {
      await navigator.clipboard.writeText(value);
      if (alive.current) setNotice(`${label} ${label === 'Credencial' ? 'copiada' : 'copiado'}.`);
    } catch {
      if (alive.current) setError('Não foi possível copiar. Selecione o campo e use a opção de cópia do navegador.');
    }
  }
  return (
    <section className="eia-panel min-w-0 space-y-5 p-4 sm:p-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2
            ref={sectionTitle}
            tabIndex={-1}
            id={`${id}-title`}
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <Link2 aria-hidden="true" className="size-5" />
            Fecha IA · revisões comerciais
          </h2>
          <p className="text-sm text-muted-foreground">
            Autorize uma equipe da Fecha IA a registrar notas de revisão e tarefas opcionais neste CRM.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={busy || loading} onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" className="size-4" />
          Atualizar conexões
        </Button>
      </div>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando conexões e integrantes autorizáveis…
        </p>
      )}
      {error && !dialog && (
        <p role="alert" className="rounded-xl border border-destructive/30 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {createUncertain && (
        <p className="text-sm text-muted-foreground">
          Atualize a lista para conferir se a conexão foi criada. Se ela apareceu sem a credencial, revogue-a e gere
          outra; a credencial não pode ser recuperada.
        </p>
      )}
      {secret && (
        <div className="min-w-0 space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <h3
            ref={secretTitle}
            tabIndex={-1}
            className="flex items-center gap-2 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <KeyRound aria-hidden="true" className="size-4" />
            Copie a conexão para a Fecha IA
          </h3>
          <p className="text-sm text-muted-foreground">
            A credencial é apresentada somente agora. Copie o identificador e a credencial para a configuração da equipe
            na Fecha IA antes de ocultar este quadro.
          </p>
          {/* Cada rótulo só com o texto: o botão de cópia fica fora dele e não entra no nome do campo. */}
          <div className="space-y-2 text-sm">
            <label htmlFor={`${id}-connection-id`} className="block">
              Identificador da conexão criada
            </label>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Input
                id={`${id}-connection-id`}
                className="min-w-0 flex-1 basis-52"
                readOnly
                value={secret.connection.id}
              />
              <Button type="button" variant="outline" onClick={() => void copy(secret.connection.id, 'Identificador')}>
                <Copy aria-hidden="true" className="size-4" />
                Copiar identificador
              </Button>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <label htmlFor={`${id}-token`} className="block">
              Credencial exibida uma única vez
            </label>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Input
                id={`${id}-token`}
                type="password"
                className="min-w-0 flex-1 basis-52"
                readOnly
                value={secret.token}
                autoComplete="off"
              />
              <Button type="button" variant="outline" onClick={() => void copy(secret.token, 'Credencial')}>
                <Copy aria-hidden="true" className="size-4" />
                Copiar credencial
              </Button>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-auto max-w-full whitespace-normal text-left"
            onClick={() => {
              setSecret(null);
              setNotice('Credencial ocultada. Ela não poderá ser exibida novamente.');
            }}
          >
            Já copiei; ocultar credencial
          </Button>
        </div>
      )}
      {unavailable ? (
        <p role="status" className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
          {unavailable}
        </p>
      ) : (
        <>
          <form
            className="space-y-4 border-t border-border pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <h3 className="font-semibold">Gerar conexão</h3>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="block min-w-0 space-y-2 text-sm">
                <span>Nome da conexão</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Equipe de vendas"
                  maxLength={200}
                  required
                  disabled={busy || loading || Boolean(secret)}
                />
              </label>
              <label className="block min-w-0 space-y-2 text-sm">
                <span>Identificador da equipe Fecha IA</span>
                <Input
                  value={sourceOrganizationId}
                  onChange={(event) => setSourceOrganizationId(event.target.value)}
                  placeholder="Copie da configuração da Fecha IA"
                  maxLength={36}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy || loading || Boolean(secret)}
                />
              </label>
              <label className="block min-w-0 space-y-2 text-sm">
                <span>Válida até</span>
                <Input
                  type="datetime-local"
                  className="max-w-full"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  min={localDate(Math.ceil((Date.now() + 3_600_000) / 60_000) * 60_000)}
                  max={localDate(Date.now() + 90 * 86_400_000)}
                  required
                  disabled={busy || loading || Boolean(secret)}
                />
                <span className="text-xs text-muted-foreground">Entre 1 hora e 90 dias a partir de agora.</span>
              </label>
            </div>
            <ActorChoices
              actors={actors}
              selected={allowedActorIds}
              onChange={setAllowedActorIds}
              disabled={busy || loading || Boolean(secret)}
              label="Identidades autorizadas nesta conexão"
            />
            <ReadChoices selected={readScopes} onChange={setReadScopes} disabled={busy || loading || Boolean(secret)} />
            <Button
              type="submit"
              className="h-auto max-w-full whitespace-normal text-left"
              disabled={
                busy ||
                loading ||
                Boolean(secret) ||
                createUncertain ||
                !name.trim() ||
                !sourceOrganizationId.trim() ||
                !expiresAt ||
                !allowedActorIds.length
              }
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
              {busy && !dialog ? 'Processando…' : 'Gerar credencial para a Fecha IA'}
            </Button>
          </form>
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="font-semibold">Conexões desta organização</h3>
            {!loading && !connections.length && (
              <p className="text-sm text-muted-foreground">Nenhuma conexão criada para a Fecha IA.</p>
            )}
            <ul className="space-y-3">
              {connections.map((connection) => {
                const active = !connection.revokedAt && new Date(connection.expiresAt).getTime() > now;
                return (
                  <li key={connection.id} className="min-w-0 space-y-3 rounded-xl border border-border p-4">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <h4 className="min-w-0 break-words font-medium">{connection.name}</h4>
                      <p className="text-xs font-medium text-muted-foreground">
                        {connection.revokedAt ? 'Revogada' : active ? 'Autorização ativa' : 'Expirada'}
                      </p>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">
                      Equipe Fecha IA: {connection.sourceOrganizationId}
                    </p>
                    <p className="text-xs text-muted-foreground">Validade: {dateLabel(connection.expiresAt)}</p>
                    <p className="break-words text-sm">
                      Identidades:{' '}
                      {connection.allowedActorIds
                        .map(
                          (actorId) => actors.find((actor) => actor.id === actorId)?.label ?? 'Identidade indisponível',
                        )
                        .join(', ')}
                    </p>
                    <p className="break-words text-sm">Leituras: {readSummary(readScopesOf(connection))}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !active}
                        onClick={(event) => {
                          dialogTrigger.current = event.currentTarget;
                          setError('');
                          setEditingActors([...connection.allowedActorIds]);
                          setDialog({ mode: 'actors', connection });
                        }}
                      >
                        Editar identidades
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !active}
                        onClick={(event) => {
                          dialogTrigger.current = event.currentTarget;
                          setError('');
                          setEditingReads(readScopesOf(connection));
                          setDialog({ mode: 'reads', connection });
                        }}
                      >
                        Editar leituras
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || Boolean(connection.revokedAt)}
                        onClick={(event) => {
                          dialogTrigger.current = event.currentTarget;
                          setError('');
                          setDialog({ mode: 'revoke', connection });
                        }}
                      >
                        Revogar conexão
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            className="eia-overlay fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto border p-5"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (dialogTrigger.current && !dialogTrigger.current.disabled) dialogTrigger.current.focus();
              else sectionTitle.current?.focus();
            }}
            onKeyDownCapture={(event) => {
              if (event.key === 'Escape' && !event.defaultPrevented && !busy) {
                event.preventDefault();
                event.stopPropagation();
                setDialog(null);
              }
            }}
          >
            <div className="space-y-2 pr-8">
              <DialogTitle>
                {dialog?.mode === 'revoke'
                  ? 'Revogar conexão da Fecha IA'
                  : dialog?.mode === 'reads'
                    ? 'Editar leituras da Fecha IA'
                    : 'Editar identidades autorizadas'}
              </DialogTitle>
              <DialogDescription>
                {dialog?.connection.name}.{' '}
                {dialog?.mode === 'revoke'
                  ? 'A credencial deixará de autorizar novos registros. Notas e tarefas já recebidas permanecem no CRM.'
                  : dialog?.mode === 'reads'
                    ? 'Escolha o que a Fecha IA pode ler desta organização. Desligar uma leitura vale na consulta seguinte.'
                    : 'Selecione as identidades que esta conexão poderá usar. Retirar alguém impede novos envios em seu nome.'}
              </DialogDescription>
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                className="absolute right-2 top-2"
                aria-label="Fechar configuração da conexão"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </DialogPrimitive.Close>
            {dialog?.mode === 'actors' && (
              <ActorChoices
                actors={actors}
                selected={editingActors}
                onChange={setEditingActors}
                disabled={busy}
                label="Identidades que continuarão autorizadas"
              />
            )}
            {dialog?.mode === 'reads' && (
              <ReadChoices selected={editingReads} onChange={setEditingReads} disabled={busy} />
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="h-auto max-w-full whitespace-normal text-left"
                variant={dialog?.mode === 'revoke' ? 'destructive' : 'default'}
                disabled={busy || (dialog?.mode === 'actors' && !editingActors.length)}
                onClick={() => void saveDialog()}
              >
                {busy
                  ? 'Salvando…'
                  : dialog?.mode === 'revoke'
                    ? 'Confirmar revogação'
                    : dialog?.mode === 'reads'
                      ? 'Salvar leituras'
                      : 'Salvar identidades autorizadas'}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </section>
  );
}
