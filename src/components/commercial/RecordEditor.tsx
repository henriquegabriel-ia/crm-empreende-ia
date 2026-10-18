import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ds/dialog';
import { Select, SelectTrigger, SelectContent, SelectValue, SelectItem } from '@/components/ds/select';
import {
  CONTACT_STATUS_LABELS,
  relationshipError,
  safeWebsite,
  type Company,
  type Contact,
  type DirectoryKind,
  type RelationshipData,
} from '@/lib/contact-model';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { CONTACT_IMPORT_LIMITS } from '@/lib/contact-import';
import { assignableMembers, memberLabel } from '@/lib/team-members';
import { phoneInputValue, phoneToStore } from '@/lib/phone';
import { PhonePreview } from '@/components/channels/PhonePreview';
import { LegalBasisFields } from '@/components/privacy/LegalBasisFields';
import { useOrganizationPrivacy } from '@/components/privacy/data';
import {
  COMPANY_DEFAULT_CHOICE,
  companyDefaultLabel,
  legalBasisChanges,
  legalBasisNoteError,
  legalBasisOf,
  type LegalBasisChoice,
} from '@/lib/privacy';
import { PRIVACY_MIGRATION_MISSING, privacyMigrationMissing } from '@/lib/rpc-errors';
import { toast } from 'sonner';

interface Props {
  kind: DirectoryKind;
  record?: Contact | Company;
  data: RelationshipData;
  onClose: () => void;
  onSaved: (id: string) => void;
}
export function RecordEditor({ kind, record: initialRecord, data, onClose, onSaved }: Props) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { canWrite } = useCrmPermissions();
  const cache = useQueryClient();
  // O formulário e a versão que ele edita ficam juntos quando os dados são recarregados em segundo plano: a guarda
  // de concorrência compara com a versão aberta, e não com a mais recente.
  const [record] = useState(initialRecord);
  const contact = record && 'first_name' in record ? record : undefined;
  const company = record && 'name' in record ? record : undefined;
  const [form, setForm] = useState({
    first_name: contact?.first_name ?? '',
    last_name: contact?.last_name ?? '',
    email: contact?.email ?? '',
    // O E.164 gravado abre como "(11) 99999-0000" (item 1.9); um número não reconhecido abre como foi gravado.
    phone: phoneInputValue(record?.phone),
    company_id: contact?.company_id ?? '',
    owner_id: record ? (record.owner_id ?? '') : (user?.id ?? ''),
    status: contact?.status ?? 'lead',
    job_title: contact?.job_title ?? '',
    source: contact?.source ?? '',
    notes: contact?.notes ?? '',
    name: company?.name ?? '',
    industry: company?.industry ?? '',
    website: company?.website ?? '',
  });
  // Base legal (item 1.10): na edição, a gravada; na criação, o padrão da empresa, que o banco preenche. Num banco sem a
  // migração, o contato lido não tem a coluna e a leitura do padrão diz que ela falta: o grupo não aparece, e criar e
  // editar continuam como antes.
  const organizationPrivacy = useOrganizationPrivacy(kind === 'contacts' && !record);
  const privacyAvailable =
    kind === 'contacts' && (contact ? 'legal_basis' in contact : organizationPrivacy.data?.available !== false);
  const [legalBasis, setLegalBasis] = useState<LegalBasisChoice>(
    contact ? legalBasisOf(contact) : COMPANY_DEFAULT_CHOICE,
  );
  const [legalBasisNote, setLegalBasisNote] = useState(contact?.legal_basis_note ?? '');
  const [legalBasisError, setLegalBasisError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phonePreviewId = useId();
  const change = (key: keyof typeof form, value: string) => setForm((v) => ({ ...v, [key]: value }));
  const nullable = (value: string) => value.trim() || null;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!orgId || !user || !canWrite || saving) return;
    if (!(kind === 'contacts' ? form.first_name : form.name).trim()) {
      setError('Informe um nome para este cadastro.');
      return;
    }
    if (kind === 'companies' && form.website && !safeWebsite(form.website)) {
      setError('Informe um site válido com protocolo HTTP ou HTTPS.');
      return;
    }
    const noteProblem = privacyAvailable ? legalBasisNoteError(legalBasis, legalBasisNote) : null;
    setLegalBasisError(noteProblem);
    if (noteProblem) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // O telefone brasileiro reconhecido vai em E.164, como na importação desde o item 0.5 (item 1.9).
      const common = { org_id: orgId, phone: phoneToStore(form.phone).value, owner_id: nullable(form.owner_id) };
      const request =
        kind === 'contacts'
          ? (() => {
              const payload = {
                ...common,
                first_name: form.first_name.trim(),
                last_name: nullable(form.last_name),
                email: nullable(form.email),
                company_id: nullable(form.company_id),
                status: form.status,
                // Cargo, origem e observações chegam também pela importação (item 1.11) e se corrigem aqui.
                job_title: nullable(form.job_title),
                source: nullable(form.source),
                notes: nullable(form.notes),
                // Só o que mudou, e nunca a data nem o autor, que o banco carimba.
                ...(privacyAvailable ? legalBasisChanges(contact ?? null, legalBasis, legalBasisNote) : {}),
              };
              return record
                ? crmDb
                    .from('contacts')
                    .update(payload)
                    .eq('org_id', orgId)
                    .eq('id', record.id)
                    .eq('updated_at', record.updated_at)
                    .select('id')
                    .maybeSingle()
                : crmDb.from('contacts').insert(payload).select('id').single();
            })()
          : (() => {
              const payload = {
                ...common,
                name: form.name.trim(),
                industry: nullable(form.industry),
                website: form.website ? safeWebsite(form.website) : null,
              };
              return record
                ? crmDb
                    .from('companies')
                    .update(payload)
                    .eq('org_id', orgId)
                    .eq('id', record.id)
                    .eq('updated_at', record.updated_at)
                    .select('id')
                    .maybeSingle()
                : crmDb.from('companies').insert(payload).select('id').single();
            })();
      const result = await request;
      if (result.error) throw result.error;
      if (!result.data) {
        // Outra pessoa alterou ou excluiu o cadastro depois que ele foi aberto: nada é sobrescrito.
        setError(
          `${kind === 'contacts' ? 'Este contato mudou' : 'Esta empresa mudou'} ou não está mais disponível. Seu preenchimento foi preservado; copie suas alterações e reabra o cadastro para revisar os dados atuais.`,
        );
        await invalidateCrmTables(cache, [kind]);
        return;
      }
      await invalidateCrmTables(cache, [kind]);
      toast.success(record ? 'Cadastro atualizado' : 'Cadastro criado');
      onSaved(result.data.id);
    } catch (cause) {
      setError(privacyMigrationMissing(cause) ? PRIVACY_MIGRATION_MISSING : relationshipError(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {record ? 'Editar' : 'Novo'} {kind === 'contacts' ? 'contato' : 'cadastro de empresa'}
          </DialogTitle>
          <DialogDescription>
            Dados de relacionamento da sua organização. Campos com * são obrigatórios.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {kind === 'contacts' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="record-first">Nome *</Label>
                  <Input
                    id="record-first"
                    required
                    maxLength={100}
                    autoFocus
                    value={form.first_name}
                    onChange={(e) => change('first_name', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="record-last">Sobrenome</Label>
                  <Input
                    id="record-last"
                    maxLength={150}
                    value={form.last_name}
                    onChange={(e) => change('last_name', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="record-email">E-mail</Label>
                <Input
                  id="record-email"
                  type="email"
                  maxLength={254}
                  value={form.email}
                  onChange={(e) => change('email', e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="record-name">Nome da empresa *</Label>
                <Input
                  id="record-name"
                  required
                  maxLength={200}
                  autoFocus
                  value={form.name}
                  onChange={(e) => change('name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="record-industry">Segmento</Label>
                <Input
                  id="record-industry"
                  maxLength={150}
                  value={form.industry}
                  onChange={(e) => change('industry', e.target.value)}
                  placeholder="Ex.: tecnologia, educação, serviços"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="record-website">Site</Label>
                <Input
                  id="record-website"
                  inputMode="url"
                  maxLength={500}
                  value={form.website}
                  onChange={(e) => change('website', e.target.value)}
                  placeholder="https://empresa.com.br"
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="record-phone">Telefone</Label>
            <Input
              id="record-phone"
              type="tel"
              maxLength={40}
              value={form.phone}
              aria-describedby={phonePreviewId}
              onChange={(e) => change('phone', e.target.value)}
            />
            <PhonePreview id={phonePreviewId} value={form.phone} />
          </div>
          {kind === 'contacts' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="record-company">Empresa</Label>
                <Select
                  value={form.company_id || 'none'}
                  onValueChange={(v) => change('company_id', v === 'none' ? '' : v)}
                >
                  <SelectTrigger id="record-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem empresa</SelectItem>
                    {data.companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="record-status">Relacionamento</Label>
                <Select value={form.status} onValueChange={(v) => change('status', v)}>
                  <SelectTrigger id="record-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!Object.keys(CONTACT_STATUS_LABELS).includes(form.status) && (
                      <SelectItem value={form.status}>{form.status}</SelectItem>
                    )}
                    {Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {kind === 'contacts' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="record-job-title">Cargo</Label>
                  <Input
                    id="record-job-title"
                    maxLength={CONTACT_IMPORT_LIMITS.job_title}
                    value={form.job_title}
                    onChange={(e) => change('job_title', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="record-source">Origem</Label>
                  <Input
                    id="record-source"
                    maxLength={CONTACT_IMPORT_LIMITS.source}
                    value={form.source}
                    onChange={(e) => change('source', e.target.value)}
                    placeholder="Ex.: indicação, site, feira"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="record-notes">Observações</Label>
                <Textarea
                  id="record-notes"
                  rows={3}
                  maxLength={CONTACT_IMPORT_LIMITS.notes}
                  value={form.notes}
                  onChange={(e) => change('notes', e.target.value)}
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="record-owner">Responsável</Label>
            <Select value={form.owner_id || 'none'} onValueChange={(v) => change('owner_id', v === 'none' ? '' : v)}>
              <SelectTrigger id="record-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {/* Sem desativados (item 1.2); o responsável atual desativado aparece marcado, para ser trocado. */}
                {assignableMembers(data.members, record?.owner_id).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {memberLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {privacyAvailable && (
            <LegalBasisFields
              contact={contact}
              choice={legalBasis}
              note={legalBasisNote}
              onChoiceChange={(choice) => {
                setLegalBasis(choice);
                setLegalBasisError(null);
              }}
              onNoteChange={(note) => {
                setLegalBasisNote(note);
                setLegalBasisError(null);
              }}
              companyDefaultLabel={
                organizationPrivacy.data ? companyDefaultLabel(organizationPrivacy.data.defaultLegalBasis) : undefined
              }
              members={data.members}
              error={legalBasisError}
            />
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {!canWrite && <p className="text-sm text-muted-foreground">Seu papel permite apenas consulta.</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={saving || !canWrite} type="submit">
              {saving ? 'Salvando…' : 'Salvar cadastro'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
