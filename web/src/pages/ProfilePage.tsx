import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import dayjs from 'dayjs';
import { ApiError } from '@/api/client';
import { Section, UserProfile } from '@/api/types';
import { useFeedback } from '@/context/FeedbackContext';
import { useSession } from '@/context/SessionContext';

const ProfilePage = () => {
  const { apiClient, session, updateCurrentUser, updateSession } = useSession();
  const { showFeedback } = useFeedback();

  const [profile, setProfile] = useState<UserProfile | null>(session?.user ?? null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [formState, setFormState] = useState({ name: '', jobTitle: '', phone: '', bio: '' });
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });

  useEffect(() => {
    const load = async () => {
      try {
        const [profileResponse, sectionsResponse] = await Promise.all([
          apiClient.fetchProfile(),
          apiClient.fetchSections(),
        ]);
        setProfile(profileResponse);
        setSections(sectionsResponse);
        setFormState({
          name: profileResponse.name,
          jobTitle: profileResponse.jobTitle,
          phone: profileResponse.phone,
          bio: profileResponse.bio,
        });
      } catch (error) {
        console.error('Не удалось загрузить профиль', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [apiClient]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!formState.name.trim()) {
      showFeedback('Имя не может быть пустым.', { variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      const updated = await apiClient.updateProfile({
        name: formState.name.trim(),
        jobTitle: formState.jobTitle.trim(),
        phone: formState.phone.trim(),
        bio: formState.bio.trim(),
      });
      setProfile(updated);
      updateCurrentUser(updated);
      showFeedback('Профиль обновлён.', { variant: 'success' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить профиль';
      showFeedback(message, { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) {
      showFeedback('Заполните все поля для смены пароля.', { variant: 'error' });
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      showFeedback('Пароли не совпадают.', { variant: 'error' });
      return;
    }
    setChangingPassword(true);
    try {
      const sessionResponse = await apiClient.changePassword(passwordForm.current, passwordForm.next);
      updateSession(sessionResponse);
      showFeedback('Пароль обновлён.', { variant: 'success' });
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить пароль';
      showFeedback(message, { variant: 'error' });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading || !profile) {
    return <p>Загрузка профиля…</p>;
  }

  const createdAt = dayjs(profile.createdAt).format('DD.MM.YYYY HH:mm');
  const roleLabel = apiClient.getRoleLabel(profile.role);

  return (
    <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
      <section className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header>
          <h2 style={{ margin: 0 }}>Профиль оператора</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)' }}>Аккаунт создан: {createdAt}</p>
        </header>
        <p style={{ margin: 0 }}>Текущая роль: {roleLabel}</p>
        <div>
          <h3 style={{ marginBottom: 8 }}>Назначенные разделы</h3>
          {profile.sections.length === 0 ? (
            <p style={{ color: 'var(--color-on-surface-variant)' }}>Разделы ещё не назначены.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {profile.sections.map((sectionId) => {
                const match = sections.find((section) => section.id === sectionId);
                return <span key={sectionId} className="chip">{match?.title ?? sectionId}</span>;
              })}
            </div>
          )}
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Назначенные БИНы</h3>
          {profile.bins.length === 0 ? (
            <p style={{ color: 'var(--color-on-surface-variant)' }}>БИНы ещё не назначены.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {profile.bins.map((bin) => (
                <span key={bin} className="chip">{bin}</span>
              ))}
            </div>
          )}
        </div>
        <p style={{ margin: 0, color: 'var(--color-on-surface-variant)' }}>
          Избранных диалогов: {profile.favoriteChatIds.length}
        </p>
      </section>
      <section className="card" style={{ padding: 24 }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Редактирование профиля</h3>
          <label style={labelStyle}>
            <span>Имя и фамилия</span>
            <input
              type="text"
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            <span>Должность</span>
            <input
              type="text"
              value={formState.jobTitle}
              onChange={(event) => setFormState((prev) => ({ ...prev, jobTitle: event.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Телефон</span>
            <input
              type="tel"
              value={formState.phone}
              onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Описание</span>
            <textarea
              value={formState.bio}
              onChange={(event) => setFormState((prev) => ({ ...prev, bio: event.target.value }))}
              style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={saving}
              style={primaryButtonStyle(saving)}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="outline-button"
              onClick={() => {
                setFormState({
                  name: profile.name,
                  jobTitle: profile.jobTitle,
                  phone: profile.phone,
                  bio: profile.bio,
                });
              }}
            >
              Сбросить
            </button>
          </div>
        </form>
      </section>
      <section className="card" style={{ padding: 24, gridColumn: '1 / -1' }}>
        <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Смена пароля</h3>
          <label style={labelStyle}>
            <span>Текущий пароль</span>
            <input
              type="password"
              value={passwordForm.current}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, current: event.target.value }))}
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            <span>Новый пароль</span>
            <input
              type="password"
              value={passwordForm.next}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, next: event.target.value }))}
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            <span>Подтверждение пароля</span>
            <input
              type="password"
              value={passwordForm.confirm}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirm: event.target.value }))}
              style={inputStyle}
              required
            />
          </label>
          <button type="submit" disabled={changingPassword} style={primaryButtonStyle(changingPassword)}>
            {changingPassword ? 'Обновление…' : 'Сменить пароль'}
          </button>
        </form>
      </section>
    </div>
  );
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 14,
  border: '1px solid var(--color-outline)',
  background: '#fff',
};

const primaryButtonStyle = (loading: boolean): CSSProperties => ({
  borderRadius: 14,
  border: 'none',
  background: 'var(--color-primary)',
  color: '#fff',
  padding: '12px 20px',
  fontWeight: 600,
  cursor: 'pointer',
  minWidth: 160,
  opacity: loading ? 0.7 : 1,
});

export default ProfilePage;
