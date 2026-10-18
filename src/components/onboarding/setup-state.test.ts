import { describe, expect, it } from 'vitest';
import { quotedLabels, showsLabel } from '@/test/ui-labels';
import { emptySetupEvidence, nextSetupStep, parseGuideStep, SETUP_STEPS, setupGuideKey } from './setup-state';

describe('configuration guide position', () => {
  it('has exactly the six real requirements and chooses the first unverified one', () => {
    // Item 1.10: a base legal padrão vem antes do primeiro contato, porque vale para os contatos que vierem depois.
    expect(SETUP_STEPS.map((step) => step.id)).toEqual([
      'identity',
      'pipeline',
      'privacy',
      'contact',
      'opportunity',
      'activity',
    ]);
    expect(nextSetupStep(emptySetupEvidence())).toBe('identity');
    expect(
      nextSetupStep({ ...emptySetupEvidence(), identity: 'done', pipeline: 'done', privacy: 'done', contact: 'error' }),
    ).toBe('contact');
    expect(nextSetupStep({ ...emptySetupEvidence(), identity: 'done', pipeline: 'done' })).toBe('privacy');
    expect(
      nextSetupStep({
        identity: 'done',
        pipeline: 'done',
        privacy: 'done',
        contact: 'done',
        opportunity: 'done',
        activity: 'done',
      }),
    ).toBe('identity');
  });
  it('accepts only a stable step and rejects stale, malformed and personal data as position', () => {
    expect(parseGuideStep(JSON.stringify({ version: 1, stepId: 'contact' }))).toBe('contact');
    for (const value of [
      null,
      'invalid',
      '{',
      'null',
      JSON.stringify({ version: 2, stepId: 'contact' }),
      JSON.stringify({ version: 1, stepId: 'private@example.com' }),
    ])
      expect(parseGuideStep(value)).toBeNull();
  });
  it('keeps saved position separated by organization and person', () => {
    expect(setupGuideKey('org:a', 'user/b')).toBe('empreende-crm:setup-guide:v1:org%3Aa:user%2Fb');
    expect(setupGuideKey('org:a', 'user/b')).not.toBe(setupGuideKey('org', 'a:user/b'));
    expect(setupGuideKey('org:a', 'user/b')).not.toBe(setupGuideKey('org:a', 'other'));
  });
  it('describes what each step checks, as the evidence in useCrmOnboarding does', () => {
    const description = (id: string) => SETUP_STEPS.find((step) => step.id === id)!.description;
    // A empresa nasce com o funil Comercial e quatro etapas (private.provision_organization, item 1.1).
    expect(description('pipeline')).toContain('funil Comercial');
    // Só uma atividade pendente com prazo, e que não seja nota, conta como próxima ação.
    expect(description('activity')).toMatch(/pendente, com prazo/);
    expect(description('activity')).toContain('tarefa, ligação, WhatsApp, e-mail, reunião ou visita');
    expect(description('activity')).toContain('Notas e atividades sem prazo não contam');
    // O responsável é recomendação: useCrmOnboarding não o exige.
    expect(description('activity')).not.toMatch(/com prazo e responsável/);
    expect(description('contact')).toContain('importe uma planilha em “Integrações”');
    expect(description('identity')).toContain('convidam a equipe em “Equipe”');
    expect(description('pipeline')).toContain('na aba “Funis”');
    expect(SETUP_STEPS.find((step) => step.id === 'pipeline')!.admin).toBe(true);
    // Item 1.10: a base legal padrão, em Configurações > Organização, só para donos e administradores, com o aviso de
    // cada etapa de gestores e a recomendação de revisão jurídica.
    const privacy = SETUP_STEPS.find((step) => step.id === 'privacy')!;
    expect(privacy).toMatchObject({ admin: true, path: '/settings?tab=organization', action: 'Escolher a base legal' });
    expect(privacy.description).toContain('na aba “Organização”, escolha a base legal padrão dos contatos novos');
    expect(privacy.description).toContain('Confira a escolha com quem cuida do jurídico da empresa');
    // A equipe da empresa cliente não vê a documentação do repositório: os modelos vêm de quem implantou o CRM.
    expect(privacy.description).toContain(
      'Peça a quem implantou o CRM os modelos de aviso de privacidade e de termo, que precisam de revisão jurídica.',
    );
    expect(privacy.description).not.toContain('documentação da implantação');
    for (const step of SETUP_STEPS) expect(!!step.adminNotice, step.id).toBe(!!step.admin);
  });
  // As etapas citam entre aspas curvas as telas e abas a que levam; a prova é o código dessas telas, nunca a Ajuda nem
  // os tours (src/test/ui-labels.ts). O botão de cada etapa (`action`) é o próprio CrmSetupGuide e fica fora da
  // conferência.
  const SCREENS: Record<string, string> = {
    Equipe: 'src/pages/Team.tsx',
    Configurações: 'src/pages/Settings.tsx',
    Funis: 'src/pages/Settings.tsx',
    Organização: 'src/pages/Settings.tsx',
    Integrações: 'src/pages/Integrations.tsx',
  };
  it('cites only interface names shown by the screens they lead to', () => {
    const cited = SETUP_STEPS.flatMap((step) =>
      quotedLabels(`${step.title} ${step.description}`).map((label) => ({ step: step.id, label })),
    );
    expect([...new Set(cited.map((entry) => entry.label))].sort()).toEqual(Object.keys(SCREENS).sort());
    for (const { step, label } of cited)
      expect(showsLabel(SCREENS[label], label), `${step}: “${label}” sumiu de ${SCREENS[label]}`).toBe(true);
  });
});
