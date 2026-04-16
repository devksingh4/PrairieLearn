#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { logger } from '@prairielearn/logger';

import { convert } from '../pipeline.js';
import {
  type CourseExportInfo,
  type QtiFileEntry,
  detectCourseExport,
  findQtiFilesFromManifest,
} from '../utils/course-export.js';
import { slugify } from '../utils/slugify.js';
import { stableUuid } from '../utils/uuid.js';

const program = new Command();

program
  .name('question-convert')
  .description('Convert questions from interchange formats (QTI) to PrairieLearn format')
  .argument('<input>', 'Input QTI XML file or directory of quiz exports')
  .requiredOption('--course <dir>', 'Path to PrairieLearn course directory')
  .requiredOption('--course-instance <name>', 'Course instance name (e.g. "Fall2025")')
  .option(
    '--timezone <tz>',
    'Course timezone (e.g. "America/Denver"). Read from infoCourse.json if present.',
  )
  .option('-t, --topic <topic>', 'Default topic for questions')
  .option('--tags <tags...>', 'Default tags for questions', ['imported', 'qti'])
  .option('--overwrite', 'Delete existing output directories before writing')
  .action(
    async (
      input: string,
      options: {
        course: string;
        courseInstance: string;
        timezone?: string;
        topic?: string;
        tags: string[];
        overwrite?: boolean;
      },
    ) => {
      const resolvedInput = path.resolve(input);
      const inputStat = await stat(resolvedInput);
      const courseDir = path.resolve(options.course);

      // Detect course export metadata when the input is a directory.
      // This lets us populate infoCourse.json with real course info and
      // resolve the timezone without requiring --timezone on the command line.
      let courseExportInfo: CourseExportInfo | undefined;
      if (inputStat.isDirectory()) {
        courseExportInfo = (await detectCourseExport(resolvedInput)) ?? undefined;
        if (courseExportInfo) {
          logger.info(`Detected Canvas course export: "${courseExportInfo.title}"`);
        }
      }

      // Resolve timezone: flag → course export settings → existing infoCourse.json → error
      const timezone = await resolveTimezone(
        courseDir,
        options.timezone,
        courseExportInfo?.timezone,
      );

      await ensureCourseFiles(courseDir, options.courseInstance, timezone, courseExportInfo);

      if (inputStat.isDirectory()) {
        // Prefer the manifest for file discovery — it's present in both quiz
        // exports and course exports and only lists QTI assessment resources,
        // avoiding non-QTI XML files (course settings, wiki pages, etc.).
        // Fall back to the heuristic directory scan if no manifest is found.
        const manifestFiles = await findQtiFilesFromManifest(resolvedInput);
        const entries: QtiFileEntry[] =
          manifestFiles.length > 0
            ? manifestFiles
            : (await findQtiXmlFiles(resolvedInput)).map((p) => ({
                qtiPath: p,
                assessmentDir: path.dirname(p),
              }));

        if (entries.length === 0) {
          logger.error('No QTI XML files found in directory');
          process.exit(1);
        }

        for (const entry of entries) {
          await convertFile(entry, courseDir, timezone, options);
        }
      } else {
        await convertFile(
          { qtiPath: resolvedInput, assessmentDir: path.dirname(resolvedInput) },
          courseDir,
          timezone,
          options,
        );
      }
    },
  );

program.parse();

/**
 * Determine the course timezone.
 * Priority: --timezone flag → course export settings → existing infoCourse.json → error.
 */
async function resolveTimezone(
  courseDir: string,
  flagValue?: string,
  courseExportTimezone?: string,
): Promise<string> {
  if (flagValue) return flagValue;
  if (courseExportTimezone) return courseExportTimezone;

  // Try reading from existing infoCourse.json
  const infoCourseFile = path.join(courseDir, 'infoCourse.json');
  try {
    const content = await readFile(infoCourseFile, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed['timezone'] === 'string' && parsed['timezone']) {
      return parsed['timezone'];
    }
  } catch {
    // File doesn't exist yet — fall through to error
  }

  logger.error(
    'Error: course timezone is required.\n' +
      'Pass --timezone "America/Denver" (or the appropriate IANA timezone),\n' +
      'or ensure infoCourse.json already contains a "timezone" field.',
  );
  process.exit(1);
}

const NON_QTI_XML_FILES = new Set(['assessment_meta.xml', 'imsmanifest.xml']);

function isQtiXml(filename: string): boolean {
  return filename.endsWith('.xml') && !NON_QTI_XML_FILES.has(filename);
}

/**
 * Find QTI XML files in a directory. Handles two cases:
 * - The directory itself contains a QTI XML (single quiz dir)
 * - The directory contains subdirectories, each with a QTI XML (bulk export folder)
 */
async function findQtiXmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);

  // Check if the directory itself contains a QTI XML (not a manifest)
  const directXml = entries.find(isQtiXml);
  if (directXml) {
    return [path.join(dir, directXml)];
  }

  // Otherwise look in subdirectories
  const xmlFiles: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      const subEntries = await readdir(entryPath);
      const xml = subEntries.find(isQtiXml);
      if (xml) {
        xmlFiles.push(path.join(entryPath, xml));
      }
    }
  }
  return xmlFiles;
}

async function convertFile(
  entry: QtiFileEntry,
  courseDir: string,
  timezone: string,
  options: { courseInstance: string; topic?: string; tags: string[]; overwrite?: boolean },
): Promise<void> {
  const xmlContent = await readFile(entry.qtiPath, 'utf-8');
  const webResourcesDir = path.join(entry.assessmentDir, '..', 'web_resources');

  // Read assessment_meta.xml if present (Canvas-specific metadata)
  const metaXmlPath = path.join(entry.assessmentDir, 'assessment_meta.xml');
  let assessmentMetaXml: string | undefined;
  try {
    assessmentMetaXml = await readFile(metaXmlPath, 'utf-8');
  } catch {
    // Not present — that's fine
  }

  const baseOptions = { basePath: entry.assessmentDir, assessmentMetaXml, timezone };

  // First pass to get the assessment title for building paths
  const preview = convert(xmlContent, baseOptions);
  const assessmentSlug = slugify(preview.assessmentTitle);
  const questionPrefix = `imported/${assessmentSlug}`;

  // Second pass with the correct question ID prefix
  const result = convert(xmlContent, {
    ...baseOptions,
    topic: options.topic,
    tags: options.tags,
    questionIdPrefix: questionPrefix,
  });

  const questionsDir = path.join(courseDir, 'questions', 'imported', assessmentSlug);
  const assessmentsDir = path.join(
    courseDir,
    'courseInstances',
    options.courseInstance,
    'assessments',
    assessmentSlug,
  );

  if (options.overwrite) {
    await rm(questionsDir, { recursive: true, force: true });
    await rm(assessmentsDir, { recursive: true, force: true });
  }

  for (const q of result.questions) {
    const qDir = path.join(questionsDir, q.directoryName);
    await mkdir(qDir, { recursive: true });

    await writeFile(path.join(qDir, 'info.json'), JSON.stringify(q.infoJson, null, 2) + '\n');
    await writeFile(path.join(qDir, 'question.html'), q.questionHtml);

    if (q.serverPy) {
      await writeFile(path.join(qDir, 'server.py'), q.serverPy);
    }

    if (q.clientFiles.size > 0) {
      const cfDir = path.join(qDir, 'clientFilesQuestion');
      await mkdir(cfDir, { recursive: true });
      for (const [name, content] of q.clientFiles) {
        if (Buffer.isBuffer(content)) {
          await writeFile(path.join(cfDir, name), content);
        } else {
          const srcFile = path.join(webResourcesDir, content);
          try {
            await copyFile(srcFile, path.join(cfDir, name));
          } catch {
            logger.warn(`Warning: could not find image file: ${srcFile}`);
          }
        }
      }
    }
  }

  await mkdir(assessmentsDir, { recursive: true });
  await writeFile(
    path.join(assessmentsDir, 'infoAssessment.json'),
    JSON.stringify(result.assessment.infoJson, null, 2) + '\n',
  );

  for (const w of result.warnings) {
    logger.warn(`Warning [${w.questionId}]: ${w.message}`);
  }

  logger.info(`Converted "${result.assessmentTitle}": ${result.questions.length} question(s)`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCourseFiles(
  courseDir: string,
  courseInstance: string,
  timezone: string,
  courseExportInfo?: CourseExportInfo,
): Promise<void> {
  const infoCourseFile = path.join(courseDir, 'infoCourse.json');
  if (!(await fileExists(infoCourseFile))) {
    await mkdir(courseDir, { recursive: true });
    // Use the course short code as `name` (PL requires a short identifier);
    // fall back to a slugified title, then to the generic placeholder.
    const name = courseExportInfo?.courseCode ?? courseExportInfo?.title ?? 'Imported Course';
    const title = courseExportInfo?.title ?? 'Imported Course';
    const infoCourse = {
      uuid: stableUuid(courseDir, 'course'),
      name,
      title,
      timezone,
      topics: [{ name: 'Imported', color: 'gray1', description: 'Imported from QTI' }],
      tags: [{ name: 'imported', color: 'gray1', description: 'Imported from QTI' }],
    };
    await writeFile(infoCourseFile, JSON.stringify(infoCourse, null, 2) + '\n');
    logger.info(`Created ${path.relative(process.cwd(), infoCourseFile)}`);
  }

  const ciDir = path.join(courseDir, 'courseInstances', courseInstance);
  const infoCIFile = path.join(ciDir, 'infoCourseInstance.json');
  if (!(await fileExists(infoCIFile))) {
    await mkdir(ciDir, { recursive: true });
    const infoCourseInstance = {
      uuid: stableUuid(courseDir, `ci-${courseInstance}`),
      longName: courseInstance,
      allowAccess: [
        {
          institution: 'Any',
          startDate: '1900-01-01T00:00:01',
          endDate: '2400-12-31T23:59:59',
        },
      ],
    };
    await writeFile(infoCIFile, JSON.stringify(infoCourseInstance, null, 2) + '\n');
    logger.info(`Created ${path.relative(process.cwd(), infoCIFile)}`);
  }
}
