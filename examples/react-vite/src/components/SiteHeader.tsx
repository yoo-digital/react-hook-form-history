import { GithubLogoIcon, MoonIcon, PackageIcon, SunIcon } from '@phosphor-icons/react';
import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/useTheme';

const GITHUB_URL = 'https://github.com/yoo-digital/react-hook-form-history';
const NPM_URL = 'https://www.npmjs.com/package/@yoo-digital/rhf-history';

export function SiteHeader(): JSX.Element {
  return (
    <header className="relative">
      <div
        aria-hidden
        className="paper pointer-events-none absolute inset-0 -z-10"
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-5 pb-12 sm:px-6 sm:pb-16">
        <div className="flex items-center justify-between gap-2">
          <a
            href="/"
            className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap sm:text-sm"
          >
            <img
              src="/favicon.svg"
              alt=""
              className="size-5"
            />
            @yoo-digital/rhf-history
          </a>
          <ProjectNav />
        </div>

        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="font-heading text-3xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            <span className="struck">Redo it all by hand.</span>{' '}
            <span className="retyped">Press undo.</span>
          </h1>
          <p className="max-w-xl text-sm/relaxed text-muted-foreground">
            Undo and redo for react-hook-form. It stores small patches instead of snapshots, so the
            history stays cheap on huge forms, and drafts survive a reload through IndexedDB.
          </p>
        </div>
      </div>
    </header>
  );
}

function ProjectNav(): JSX.Element {
  return (
    <nav
      className="flex items-center gap-1"
      aria-label="Project links"
    >
      <Button
        variant="ghost"
        size="sm"
        render={
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
          />
        }
      >
        <GithubLogoIcon data-icon="inline-start" />
        <span className="hidden sm:inline">GitHub</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        render={
          <a
            href={NPM_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="npm"
          />
        }
      >
        <PackageIcon data-icon="inline-start" />
        <span className="hidden sm:inline">npm</span>
      </Button>
      <ThemeToggle />
    </nav>
  );
}

function ThemeToggle(): JSX.Element {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Switch to ${next} theme`}
            onClick={toggle}
          />
        }
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </TooltipTrigger>
      <TooltipContent>Switch to {next} theme</TooltipContent>
    </Tooltip>
  );
}
