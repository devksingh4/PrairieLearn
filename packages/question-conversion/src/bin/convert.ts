#!/usr/bin/env node

import { access, copyFile, readdir, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';

import { convert } from '../pipeline.js';
import { slugify } from '../utils/slugify.js';
import { stableUuid } from '../utils/uuid.js';

const program = new Command();

program
  .name('question-convert')
  .description('Convert questions from interchange formats (QTI) to PrairieLearn format')
  .argument('<input>', 'Input QTI XML file or directory of quiz exports')
  .requiredOption('--course <dir>', 'Path to PrairieLearn course directory')
  .requiredOption('--course-instance <name>', 'Course instance name (e.g. "Fall2025")')
  .option('--timezone <tz>', 'Course timezone (e.g. "America/Denver"). Read from infoCourse.json if present.')
  .option('-t, --topic <topic>', 'Default topic for questions')
  .option('--tags <tags...>', 'Default tags for questions', ['imported', 'qti'])
  .action(
    async (
      input: string,
      options: {
        course: string;
        courseInstance: string;
        timezone?: string;
        topic?: string;
        tags: string[];
      },
    ) => {
      const resolvedInput = path.resolve(input);
      const inputStat = await stat(resolvedInput);
      const courseDir = path.resolve(options.course);

      // Resolve timezone: flag → existing infoCourse.json → error
      const timezone = await resolveTimezone(courseDir, options.timezone);

      await ensureCourseFiles(courseDir, options.courseInstance, timezone);

      if (inputStat.isDirectory()) {
        const xmlFiles = await findQtiXmlFiles(resolvedInput);

        if (xmlFiles.length === 0) {
          console.error('No QTI XML files found in directory');
          process.exit(1);
        }

        for (const xmlFile of xmlFiles) {
          await convertFile(xmlFile, courseDir, timezone, options);
        }
      } else {
        await convertFile(resolvedInput, courseDir, timezone, options);
      }
    },
  );

program.parse();

/**
 * Determine the course timezone.
 * Priority: --timezone flag → existing infoCourse.json → error.
 */
async function resolveTimezone(courseDir: string, flagValue?: string): Promise<string> {
  if (flagValue) return flagValue;

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

  console.error(
    'Error: course timezone is required.\n' +
      'Pass --timezone "America/Denver" (or the appropriate IANA timezone),\n' +
      'or ensure infoCourse.json already contains a "timezone" field.',
  );
  process.exit(1);
}

/**
 * Find QTI XML files in a directory. Handles two cases:
 * - The directory itself contains a QTI XML (single quiz dir)
 * - The directory contains subdirectories, each with a QTI XML (bulk export folder)
 */
async function findQtiXmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);

  // Check if the directory itself contains a QTI XML (not a manifest)
  const directXml = entries.find(
    (f) => f.endsWith('.xml') && f !== 'assessment_meta.xml' && f !== 'imsmanifest.xml',
  );
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
      const xml = subEntries.find((f) => f.endsWith('.xml') && f !== 'assessment_meta.xml');
      if (xml) {
        xmlFiles.push(path.join(entryPath, xml));
      }
    }
  }
  return xmlFiles;
}

async function convertFile(
  xmlPath: string,
  courseDir: string,
  timezone: string,
  options: { courseInstance: string; topic?: string; tags: string[] },
): Promise<void> {
  const xmlContent = await readFile(xmlPath, 'utf-8');
  const inputDir = path.dirname(xmlPath);
  const webResourcesDir = path.join(inputDir, '..', 'web_resources');

  // Read assessment_meta.xml if present (Canvas-specific metadata)
  const metaXmlPath = path.join(inputDir, 'assessment_meta.xml');
  let assessmentMetaXml: string | undefined;
  try {
    assessmentMetaXml = await readFile(metaXmlPath, 'utf-8');
  } catch {
    // Not present — that's fine
  }

  const baseOptions = { basePath: inputDir, assessmentMetaXml, timezone };

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
            console.warn(`Warning: could not find image file: ${srcFile}`);
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
    console.warn(`Warning [${w.questionId}]: ${w.message}`);
  }

  console.log(`Converted "${result.assessmentTitle}": ${result.questions.length} question(s)`);
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
): Promise<void> {
  const infoCourseFile = path.join(courseDir, 'infoCourse.json');
  if (!(await fileExists(infoCourseFile))) {
    await mkdir(courseDir, { recursive: true });
    const infoCourse = {
      uuid: stableUuid(courseDir, 'course'),
      name: 'Imported Course',
      title: 'Imported Course',
      timezone,
      topics: [{ name: 'Imported', color: 'gray1', description: 'Imported from QTI' }],
      tags: [{ name: 'imported', color: 'gray1', description: 'Imported from QTI' }],
    };
    await writeFile(infoCourseFile, JSON.stringify(infoCourse, null, 2) + '\n');
    console.log(`Created ${path.relative(process.cwd(), infoCourseFile)}`);
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
    console.log(`Created ${path.relative(process.cwd(), infoCIFile)}`);
  }
}
