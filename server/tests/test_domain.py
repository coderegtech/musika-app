import unittest
from server.domain import MusicContentClassifier,MetadataService,DuplicateDetectionService,normalize,duration_seconds,VIDEO_ID

def video(**changes):
    v={'id':'abcdefghijk','snippet':{'title':'Juniper - After the Rain (Official Audio)','channelTitle':'Juniper - Topic','description':'Album: A New Day','categoryId':'10','thumbnails':{'high':{'url':'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'}}},'contentDetails':{'duration':'PT3M42S'}}
    v['snippet'].update(changes)
    return v

class DomainTests(unittest.TestCase):
    def test_category_music(self): self.assertEqual(MusicContentClassifier.classify(video()),'MUSIC')
    def test_reactions_excluded_even_in_music_category(self): self.assertEqual(MusicContentClassifier.classify(video(title='Song reaction and review')),'NOT_MUSIC')
    def test_unknown_category_not_blindly_trusted(self): self.assertEqual(MusicContentClassifier.classify(video(title='Daily vlog',channelTitle='Life',description='',categoryId='22')),'NOT_MUSIC')
    def test_topic_channel_likely_music(self): self.assertEqual(MusicContentClassifier.classify(video(categoryId='22')),'LIKELY_MUSIC')
    def test_short_clip_excluded(self):
        v=video();v['contentDetails']['duration']='PT10S';self.assertEqual(MusicContentClassifier.classify(v),'NOT_MUSIC')
    def test_original_metadata_is_preserved(self):
        v=video();t=MetadataService.transform(v)
        self.assertEqual(t['original_title'],v['snippet']['title']);self.assertEqual(t['original_description'],'Album: A New Day')
        self.assertEqual(t['title'],'After the Rain');self.assertEqual(t['artist'],'Juniper');self.assertEqual(t['album'],'A New Day');self.assertEqual(t['duration'],222)
    def test_exact_source_duplicate(self):
        t=MetadataService.transform(video());self.assertEqual(DuplicateDetectionService.check(t,[t]),'ALREADY DOWNLOADED')
    def test_normalized_candidate_and_duration(self):
        t=MetadataService.transform(video());other={**t,'id':'12345678901','title':'AFTER THE RAIN!','duration':224};self.assertEqual(DuplicateDetectionService.check(other,[t]),'POSSIBLE DUPLICATE')
    def test_longer_version_is_new(self):
        t=MetadataService.transform(video());self.assertEqual(DuplicateDetectionService.check({**t,'id':'12345678901','duration':300},[t]),'NEW')
    def test_hash_duplicate(self):
        t=MetadataService.transform(video());self.assertEqual(DuplicateDetectionService.check({**t,'id':'12345678901','file_hash':'abc'},[{**t,'file_hash':'abc'}]),'ALREADY DOWNLOADED')
    def test_video_id_validation_rejects_shell_and_urls(self):
        for value in ['https://youtube.com/watch?v=abcdefghijk','abc; rm -rf /','--exec=abc','../abcdefghijk']:
            self.assertIsNone(VIDEO_ID.fullmatch(value))
    def test_iso_duration(self): self.assertEqual(duration_seconds('PT1H2M3S'),3723)

if __name__=='__main__': unittest.main()
