"""Pure metadata, classification and duplicate rules, independent of transport."""
import re
import unicodedata

VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')

def normalize(value):
    value = unicodedata.normalize('NFKD', value).casefold()
    value = re.sub(r'\((?:official|lyrics?|audio|video|visualizer)[^)]*\)|\[(?:official|lyrics?|audio|video)[^]]*\]', '', value)
    return ' '.join(re.sub(r'[^\w\s]', ' ', value).split())

def duration_seconds(value):
    match = re.fullmatch(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', value)
    return sum(int(v or 0) * scale for v, scale in zip(match.groups(), (3600, 60, 1))) if match else 0

class MusicContentClassifier:
    @staticmethod
    def classify(video):
        s = video.get('snippet', {})
        title = s.get('title', '').lower()
        duration = duration_seconds(video.get('contentDetails', {}).get('duration', ''))
        if duration < 30 or duration > 14400 or re.search(r'\b(tutorial|reaction|review|interview|podcast|how to)\b', title):
            return 'NOT_MUSIC'
        topics = ' '.join(video.get('topicDetails', {}).get('topicCategories', [])).lower()
        if s.get('categoryId') == '10' or 'music' in topics:
            return 'MUSIC'
        evidence = title + ' ' + s.get('channelTitle', '').lower() + ' ' + s.get('description', '')[:500].lower()
        return 'LIKELY_MUSIC' if re.search(r'\b(official audio|official music|lyrics|provided to youtube|topic|vevo)\b', evidence) else 'NOT_MUSIC'

class MetadataService:
    @staticmethod
    def transform(video):
        s = video['snippet']
        original = s['title']
        clean = re.sub(r'\s*[\[(](?:official[^\])]*|lyrics?|audio|music video|visualizer)[\])]', '', original, flags=re.I).strip()
        split = re.split(r'\s+[-–—]\s+', clean, maxsplit=1)
        artist, title = split if len(split) == 2 else (re.sub(r'\s*-\s*Topic$|VEVO$', '', s['channelTitle'], flags=re.I), clean)
        thumbs = s.get('thumbnails', {})
        thumbnail = next((thumbs[k]['url'] for k in ('maxres','standard','high','medium','default') if k in thumbs), '')
        desc = s.get('description', '')
        album = re.search(r'(?:Album|From the album)\s*:\s*(.+)', desc, re.I)
        return dict(id=video['id'], source='youtube', youtube_video_id=video['id'], original_title=original, original_description=desc,
                    title=title.strip(), artist=artist.strip(), normalized_title=normalize(title), normalized_artist=normalize(artist),
                    channel=s['channelTitle'], duration=duration_seconds(video['contentDetails']['duration']), thumbnail=thumbnail,
                    source_url='https://www.youtube.com/watch?v=' + video['id'], album=album.group(1).strip() if album else None,
                    release=s.get('publishedAt'), classification=MusicContentClassifier.classify(video))

class DuplicateDetectionService:
    @staticmethod
    def check(candidate, tracks):
        for track in tracks:
            if track['source'] == candidate['source'] and track['id'] == candidate['id']:
                return 'ALREADY DOWNLOADED'
            if candidate.get('file_hash') and candidate.get('file_hash') == track.get('file_hash'):
                return 'ALREADY DOWNLOADED'
        for track in tracks:
            if normalize(track['title']) == normalize(candidate['title']) and normalize(track['artist']) == normalize(candidate['artist']) and abs(track['duration'] - candidate['duration']) <= 5:
                return 'POSSIBLE DUPLICATE'
        return 'NEW'
