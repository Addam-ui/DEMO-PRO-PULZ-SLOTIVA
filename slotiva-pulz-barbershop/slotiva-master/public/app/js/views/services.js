import { get, post, put, del } from '../api.js';
import { h, icon, fmt, plural, openModal, field, withBusy, alertBox, emptyState, toast, confirmDialog, switchControl } from '../ui.js';

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

export async function mount({ view, actions, setSubtitle }) {
  setSubtitle('Co si mohou zákazníci rezervovat');
  let services = [];
  let colors = [];

  actions.append(h('button', { type: 'button', class: 'btn btn-primary', onClick: () => edit(null) }, icon('plus'), h('span', { class: 'btn-label' }, 'Přidat službu')));

  const card = h('div', { class: 'card' });
  view.append(card, h('p', { class: 'muted', style: { marginTop: '12px', maxWidth: '720px' } },
    'Pořadí odpovídá pořadí na rezervační stránce. Skrytou službu zákazníci neuvidí, ale její rezervace zůstávají. Barva služby se použije i pro událost v Google Kalendáři.'));

  async function load() {
    ({ services, colors } = await get('/services'));
    render();
  }

  function render() {
    if (!services.length) {
      card.replaceChildren(emptyState('layers', 'Zatím žádné služby', 'Přidejte první službu, kterou si zákazníci mohou rezervovat.',
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => edit(null) }, icon('plus', 14), 'Přidat službu')));
      return;
    }
    card.replaceChildren(h('div', { class: 'svc-list' }, services.map((s, i) => h('div', { class: `svc-row${s.active ? '' : ' is-inactive'}` },
      h('div', { class: 'svc-order' },
        h('button', { type: 'button', 'aria-label': `Posunout „${s.name}“ výš`, disabled: i === 0, onClick: () => move(i, -1) }, icon('chevronUp', 14)),
        h('button', { type: 'button', 'aria-label': `Posunout „${s.name}“ níž`, disabled: i === services.length - 1, onClick: () => move(i, 1) }, icon('chevronDown', 14))),
      h('span', { class: 'swatch', style: { background: s.color, width: '14px', height: '14px', borderRadius: '4px' } }),
      h('div', { style: { minWidth: '0' } },
        h('div', { class: 'svc-name' }, s.name, s.active ? null : h('span', { class: 'badge', style: { marginLeft: '8px' } }, 'Skrytá')),
        s.description ? h('div', { class: 'svc-desc' }, s.description) : null),
      h('div', { class: 'svc-meta' }, fmt.duration(s.durationMin)),
      h('div', { class: 'svc-meta' }, fmt.price(s.price)),
      h('div', { class: 'svc-meta svc-upcoming muted' }, s.upcomingCount ? plural(s.upcomingCount, ['nadcházející', 'nadcházející', 'nadcházejících']) : 'bez rezervací'),
      h('div', { class: 'svc-actions' },
        switchControl({ checked: s.active, ariaLabel: `Zobrazovat „${s.name}“ na rezervační stránce`, onChange: (value) => toggleActive(s, value) }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Upravit „${s.name}“`, title: 'Upravit', onClick: () => edit(s) }, icon('edit')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Smazat „${s.name}“`, title: 'Smazat', onClick: () => remove(s) }, icon('trash')))))));
  }

  async function move(index, direction) {
    const target = index + direction;
    [services[index], services[target]] = [services[target], services[index]];
    render();
    try {
      await post('/services/reorder', { ids: services.map((s) => s.id) });
    } catch (err) {
      toast(err.message, { error: true });
      load();
    }
  }

  async function toggleActive(service, active) {
    try {
      await put(`/services/${service.id}`, { ...service, active });
      toast(active ? `„${service.name}“ je vidět na rezervační stránce` : `„${service.name}“ je skrytá`);
    } catch (err) {
      toast(err.message, { error: true });
    }
    load();
  }

  function edit(service) {
    const isNew = !service;
    const data = service
      ? { ...service }
      : { name: '', description: '', durationMin: 60, price: 0, colorId: colors[0]?.id || '9', active: true };

    const m = openModal({ title: isNew ? 'Nová služba' : 'Upravit službu' });
    const error = h('div');
    const name = h('input', { class: 'input', id: 'svc-name', value: data.name, maxlength: '80', placeholder: 'Např. Dámský střih' });
    const description = h('textarea', { class: 'textarea', id: 'svc-desc', rows: '2', maxlength: '400', value: data.description, placeholder: 'Krátký popis pro zákazníky (nepovinné)' });
    const duration = h('input', { class: 'input', id: 'svc-duration', type: 'number', min: '5', max: '720', step: '5', value: String(data.durationMin) });
    const price = h('input', { class: 'input', id: 'svc-price', type: 'number', min: '0', step: '10', value: String(data.price) });
    const chips = h('div', { class: 'chips' });
    const palette = h('div', { class: 'color-picker', role: 'radiogroup', 'aria-label': 'Barva služby' });

    const paintChips = () => chips.replaceChildren(...DURATION_PRESETS.map((p) => h('button', {
      type: 'button',
      class: Number(duration.value) === p ? 'is-selected' : null,
      onClick: () => {
        duration.value = String(p);
        paintChips();
      },
    }, fmt.duration(p))));
    const paintPalette = () => palette.replaceChildren(...colors.map((c) => h('button', {
      type: 'button',
      role: 'radio',
      title: c.name,
      'aria-label': c.name,
      'aria-checked': String(c.id === data.colorId),
      class: c.id === data.colorId ? 'is-selected' : null,
      style: { background: c.hex },
      onClick: () => {
        data.colorId = c.id;
        paintPalette();
      },
    }, c.id === data.colorId ? icon('check', 14) : null)));
    duration.addEventListener('input', paintChips);
    paintChips();
    paintPalette();

    m.body.append(error, h('div', { class: 'form-grid' },
      field('Název', name, { wide: true }),
      field('Popis', description, { wide: true }),
      h('div', { class: 'field' }, h('label', { for: 'svc-duration' }, 'Délka'), h('div', { class: 'input-suffix' }, duration, h('span', {}, 'min')), chips),
      h('div', { class: 'field' }, h('label', { for: 'svc-price' }, 'Cena'), h('div', { class: 'input-suffix' }, price, h('span', {}, 'Kč')), h('div', { class: 'hint' }, '0 Kč = zobrazí se „Zdarma“')),
      h('div', { class: 'field span-2' }, h('span', { class: 'label' }, 'Barva'), palette),
      h('div', { class: 'span-2' }, switchControl({ checked: data.active, label: 'Zobrazovat na rezervační stránce', onChange: (value) => { data.active = value; } }))));

    m.foot.append(
      h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => m.close() }, 'Zrušit'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: (e) => withBusy(e.currentTarget, async () => {
          const body = {
            name: name.value,
            description: description.value,
            durationMin: Number(duration.value),
            price: Number(price.value || 0),
            colorId: data.colorId,
            active: data.active,
          };
          try {
            if (isNew) await post('/services', body);
            else await put(`/services/${service.id}`, body);
            m.close();
            toast(isNew ? 'Služba přidána' : 'Změny uloženy');
            load();
          } catch (err) {
            error.replaceChildren(alertBox('critical', null, err.message));
          }
        }),
      }, icon('check'), isNew ? 'Přidat službu' : 'Uložit změny'),
    );
  }

  async function remove(service) {
    const result = await confirmDialog({
      title: `Smazat službu „${service.name}“?`,
      message: service.upcomingCount
        ? `Služba má ${plural(service.upcomingCount, ['nadcházející rezervaci', 'nadcházející rezervace', 'nadcházejících rezervací'])}. Ty zůstanou zachované, jen službu už nepůjde vybrat. Pokud ji chcete schovat jen dočasně, použijte raději přepínač.`
        : 'Služba zmizí z rezervační stránky. Historie rezervací zůstane zachovaná.',
      confirmLabel: 'Smazat službu',
      danger: true,
    });
    if (!result) return;
    try {
      await del(`/services/${service.id}`);
      toast('Služba smazána');
      load();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  await load();
}
